# Provider credentials: local encrypted persistence (M1)

## Boundary and format

Belfry's `<app_data_dir>/providers.json` format **2** contains provider metadata,
current selections, opaque credential references, and the active vault generation.
It does not contain API keys or the saved Codex official OAuth object. Unknown
agent names are retained, including their providers, credentials and selection,
when they use the recognized schema.

`<app_data_dir>/provider-vault/<generation>.vault` contains an authenticated
AES-256-GCM encrypted snapshot. Each snapshot uses a fresh random 96-bit nonce;
its format/domain and generation are bound by authenticated additional data.
API credential references are bound to their agent and provider ID in the
ciphertext. References remain stable across metadata edits and key replacements;
each commit writes a new immutable generation. OAuth JSON is stored as a whole
object in local ciphertext, not in a size-limited OS credential entry.

A random 256-bit master key is stored only in:

- macOS: the current user's Keychain generic-password store.
- Windows: the current user's Credential Manager generic credential store.

The service is `app.belfry.provider-vault.v2`; the account is the SHA-256 namespace
of the application data directory. This hash is **not** key material. Moving the
application data directory changes the account namespace and requires deliberate
recovery; copying the JSON and ciphertext alone does not transfer the OS key.
Unsupported OSes fail closed; there is no file-based or plaintext fallback.

The master key and temporary serialized/decrypted byte buffers are zeroized on
drop. Runtime provider strings and OAuth values necessarily exist in process
memory while being used; this feature does not claim protection against a
compromised running process, debugger, same-user malware with OS credential
access, swap/crash dumps, or rollback of an entire valid snapshot. Metadata such
as names and URLs is not encrypted; never use a URL/name field to store a secret.

## Migration and interrupted operations

Migration happens on the first Provider store access, not at unrelated workspace
startup. The version-1 JSON is parsed strictly: unknown fields at store, agent or
provider level, invalid JSON, unknown versions, unsupported credential shapes,
empty/corrupt files, and duplicate provider IDs stop the operation. Unknown agent
names with the known shape are preserved; unknown OAuth object members are
preserved inside the encrypted object. Non-object OAuth backups are rejected.
Errors never include raw JSON, parser excerpts, secrets, or native OS errors.

Transaction order:

1. Read and validate the primary without creating a plaintext backup.
2. Obtain the original OS master key (or create and read back a random key for a
   genuinely new vault).
3. Write a new encrypted generation, flush it and its directory entry, then read
   it back and authenticate/compare the complete payload.
4. Atomically replace the metadata using a same-directory private temporary file.
5. Only after commit, remove obsolete generations. Cleanup failure does not undo
   the commit and is retried on later successful load/save.

macOS/Unix writes use file and directory `sync_all`; Windows replacement uses
`MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` after flushing file contents.
New Unix files are created with mode `0600`; Windows inherits the application
data directory ACL. The master key is never written into that directory.

Failures before the metadata replacement leave the old primary and its referenced
ciphertext intact. A crash between writing ciphertext and metadata commit leaves
an orphan generation, not a half-migrated primary. A crash after commit uses the
new generation. A failure to flush the directory after a successful atomic rename
is an **uncertain commit**: the new primary may already be visible; both generations
are retained and the operation reports an error. Reload after repairing the disk
before retrying. No plaintext rollback/backup file is generated at any stage.

Successful migration is idempotent: subsequent loads do not create another vault
or master key. Saving edits preserves credential references unless explicitly
cleared/deleted. Failed cleanup can temporarily retain old **encrypted** secrets;
it is not a secure-erase guarantee for SSDs, snapshots, backups or OS key storage.

## Unavailable OS storage and recovery

Locked/denied/cancelled Keychain or Credential Manager access, a missing master
key, missing ciphertext/reference, or failed authentication blocks the related
Provider operation. It does not permit overwriting the vault with a new key or
falling back to plaintext. Only an explicit native not-found status allows initial
key creation, and existing metadata/ciphertext prevents replacement-key creation.

Unlock/authorize the OS store and retry. For missing or corrupt data, restore the
matching metadata, ciphertext generation and original OS master key using a trusted
recovery process. Do not delete the key or vault files as a troubleshooting step.
There is no automatic plaintext export, master-key reset, or cloud recovery.
Workspace and unrelated terminal operations must not be made dependent on Provider
migration success.

## Runtime integration contract

The store module declares its own `migration.rs` and `secrets.rs` submodules; no
additional declarations in `provider/mod.rs` are needed.

- Acquire `store::lock()?` once around the **whole** load/modify/resolve/external
  apply/save operation, including read paths that can trigger migration. Store
  functions never acquire this same mutex internally. Do not hold its guard over
  an async suspension; acquire inside the blocking operation. This is an
  in-process lock; simultaneous independent app processes writing the same data
  directory are not supported.
- `load(app)` decrypts and authenticates the **entire vault payload** for fail-closed
  validation, including credential-reference checks. It returns service-layer
  metadata with every `ProviderConfig.api_key` empty and OAuth unhydrated; references
  remain private. Thus metadata/list operations (including `models.list`) can
  decrypt the vault internally, but never receive hydrated credentials from load.
  `StoreFile`, `ProviderConfig` and `AgentProviders` cannot be serialized; their
  Debug implementations do not include credentials.
- `has_api_key(kind, id)` reports stored/pending credential presence without
  retrieving a credential for the caller.
- `save(app, &store)` preserves an existing API reference for an empty API key.
  A nonempty key means replace/create. To clear, call
  `clear_api_key(kind, id)` **and** empty `ProviderConfig.api_key`. Removing a
  provider removes its credential from the next snapshot. Successful save updates
  private generation/reference state even though its argument is a shared borrow;
  stale cloned snapshots cannot overwrite a newer commit.
- `resolve_provider(&self, app, kind, id)` returns a clone with only the selected
  provider key filled. It does not hydrate the stored runtime catalog. Vault
  authentication/validation uses a temporary decrypted payload; it is not an IPC
  return value.
- `resolve_official_auth(&mut self, app)` hydrates the OAuth backup once. Afterwards,
  setting `codex_official_auth = None` means clear; untouched/unhydrated None means
  preserve. A newly captured Some object is a replacement even before hydration.
- `persist_official_backup(&mut self, app, &Option<Value>)` commits the supplied
  OAuth backup using **already committed** provider metadata, before external CLI
  writes. It preserves the disk's old `currentId` and provider configuration, then
  updates the caller's private vault/OAuth references and its hydrated OAuth state
  to the committed backup. Pending API-reference clears, key replacements, provider
  additions/imports and metadata/selection edits remain untouched and can still
  resolve/save afterwards. Explicit None clears the backup. On commit failure,
  the caller's state is unchanged; uncertain commits still require a reload.
  This method requires the same operation lock and rejects an unrelated stale
  snapshot rather than rebasing it. If a subsequent CLI write fails, abandon the
  pending operation: only the backup, not the pending selection, was committed.
- Call `ensure_available(app, &store)` immediately before **any external CLI
  write**, including switching to official/default or clearing credentials. It
  verifies current metadata, master-key availability and ciphertext authentication.
  A genuinely fresh store may provision its master key during this check.
- Do not send runtime provider structs, hydrated OAuth, or vault references over
  IPC. Catalog/UI contracts expose only metadata and credential presence. Never
  log the resolved credential or full OAuth object.

This preflight is not a distributed transaction with external CLI files: a later
disk error can still fail a store commit after an external CLI file was applied.
Service-layer error handling must not claim that all external writes rolled back.

## UI and sensitive previews

Catalog responses use `ProviderSummary.hasApiKey`, never API key fragments or a
masked value. Drafts require `apiKeyAction: keep | replace | clear`. New entries
cannot keep; replacement must be nonblank; keep/clear must not carry a key.
Changing an endpoint while keeping its existing key is rejected: the user must
explicitly replace or clear the credential before sending it to another address.

Raw external configuration is fetched only after the user selects **查看含密钥的原始配置**.
The preview IPC commands require `revealSecrets: true`; omitted/false is rejected
before any file read. Close/provider/agent changes discard preview contents and
consent; stale responses cannot repopulate the editor. The warning covers external
plaintext files and the risk of copying credentials to the clipboard.

## External CLI plaintext exception and downgrade

This feature protects **Belfry-owned persistence only**. Codex, Claude and Pi can
still require API keys/OAuth in their own native configuration files, project
configuration or environment. Applying a provider or restoring official Codex
authentication deliberately writes the CLI-compatible values there. Those files,
CLI backups, environment inheritance, previews and third-party tools are separate
security boundaries; this feature does not claim to encrypt them.

Older Belfry versions cannot safely read format 2. **Do not downgrade in place**:
older code may fail to parse or overwrite metadata without understanding secret
references. Keep the new application/version and its matching OS key available.
Downgrade is not implemented through automatic plaintext export or backup.
Existing historical plaintext backups, filesystem snapshots and deleted blocks
are not retroactively scrubbed by migration.

## Verification using synthetic data only

`provider::store::tests` uses in-memory fake OS storage and a fault-injectable
filesystem. It covers migration/restart/idempotency, unknown agents, strict parse
failures, API keep/replace/clear/delete, stable refs, lazy OAuth preserve/clear and
large OAuth, missing master/ref/ciphertext, authentication failure, write/verify/
commit failure, interrupted generations, stale snapshots and cleanup retry.

After preparing the repository's required CLI sidecar, run:

```sh
cd src-tauri
cargo test --locked provider::store::tests
```

The native OS smoke test is **ignored by default**, requires explicit approval,
uses a unique `synthetic-test-<random>` account only, never reads application/user
credentials, and removes the synthetic OS entry even when an assertion unwinds:

```sh
# Full path ensures --exact executes the intended opt-in test:
cargo test --locked provider::store::secrets::native_tests::native_synthetic_master_key_round_trip -- --ignored --exact
```

The fake tests are not a substitute for macOS/Windows native smoke acceptance or
full Provider global/project/launch/official-auth service-path regression tests.
Never use real API keys, real CLI configuration or existing user vaults for tests.

`provider::store::path_tests` additionally exercises the production local filesystem
and CLI/project adapters together: v1 migration, restart, global Codex switch with
durable OAuth capture, independent Codex/Claude launch overlays, Claude/Pi apply,
official restore, replacement, clear and deletion. Its OS key store is synthetic;
it does not launch a desktop WebView or a real model request.

For this implementation's executed checks and outstanding platform acceptance,
see [M1 verification record](provider-credentials-verification.md).
