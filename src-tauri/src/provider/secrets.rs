//! Provider-only OS master key and authenticated ciphertext. Never formats native errors.
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, OsRng, Payload, rand_core::RngCore},
};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::terminal::AppError;

const SERVICE: &str = "app.belfry.provider-vault.v2";
const MAGIC: &[u8] = b"BELFRY-PROVIDER-VAULT\x02";
pub(super) type MasterKey = Zeroizing<[u8; 32]>;

pub(super) fn unavailable() -> AppError {
    AppError::io(
        "Provider 安全存储不可用或凭据损坏；请解锁系统凭据库并恢复原主密钥/密文后重试。未回退明文存储。",
    )
}

pub(super) trait KeyStore {
    /// None means a positively identified not-found, never an access error.
    fn read(&self) -> Result<Option<MasterKey>, AppError>;
    fn create(&self, key: &MasterKey) -> Result<(), AppError>;
}

pub(super) struct NativeKeyStore {
    account: String,
}

impl NativeKeyStore {
    pub(super) fn for_directory(path: &std::path::Path) -> Self {
        // A fixed-length account avoids the Windows target-name limit. This is an
        // installation namespace, not a credential, and is never used as key material.
        Self {
            account: format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes())),
        }
    }
}

pub(super) fn random_id() -> Result<String, AppError> {
    let mut bytes = [0u8; 16];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| unavailable())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub(super) fn master(keys: &dyn KeyStore, allow_create: bool) -> Result<MasterKey, AppError> {
    if let Some(key) = keys.read()? {
        return Ok(key);
    }
    if !allow_create {
        return Err(unavailable());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng
        .try_fill_bytes(key.as_mut())
        .map_err(|_| unavailable())?;
    keys.create(&key)?;
    let verified = keys.read()?.ok_or_else(unavailable)?;
    if *verified != *key {
        return Err(unavailable());
    }
    Ok(verified)
}

pub(super) fn encrypt(
    key: &MasterKey,
    generation: &str,
    plain: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| unavailable())?;
    let mut nonce = [0u8; 12];
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|_| unavailable())?;
    let aad = format!("{SERVICE}/{generation}");
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| unavailable())?;
    let mut bytes = MAGIC.to_vec();
    bytes.extend_from_slice(&nonce);
    bytes.extend_from_slice(&encrypted);
    Ok(bytes)
}

pub(super) fn decrypt(
    key: &MasterKey,
    generation: &str,
    bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>, AppError> {
    if !bytes.starts_with(MAGIC) || bytes.len() < MAGIC.len() + 12 + 16 {
        return Err(unavailable());
    }
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| unavailable())?;
    let aad = format!("{SERVICE}/{generation}");
    cipher
        .decrypt(
            Nonce::from_slice(&bytes[MAGIC.len()..MAGIC.len() + 12]),
            Payload {
                msg: &bytes[MAGIC.len() + 12..],
                aad: aad.as_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| unavailable())
}

fn decode_key(bytes: &[u8]) -> Result<MasterKey, AppError> {
    let key: [u8; 32] = bytes.try_into().map_err(|_| unavailable())?;
    Ok(Zeroizing::new(key))
}

#[cfg(target_os = "macos")]
impl KeyStore for NativeKeyStore {
    fn read(&self) -> Result<Option<MasterKey>, AppError> {
        match security_framework::passwords::get_generic_password(SERVICE, &self.account) {
            Ok(bytes) => decode_key(&Zeroizing::new(bytes)).map(Some),
            // errSecItemNotFound. Denied/locked/cancelled must NOT become None.
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err(unavailable()),
        }
    }
    fn create(&self, key: &MasterKey) -> Result<(), AppError> {
        if self.read()?.is_some() {
            return Err(unavailable());
        }
        security_framework::passwords::set_generic_password(SERVICE, &self.account, key.as_ref())
            .map_err(|_| unavailable())
    }
}

#[cfg(target_os = "windows")]
impl NativeKeyStore {
    fn target(&self) -> Vec<u16> {
        format!("{SERVICE}/{}", self.account)
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }
}

#[cfg(target_os = "windows")]
impl KeyStore for NativeKeyStore {
    fn read(&self) -> Result<Option<MasterKey>, AppError> {
        use windows_sys::Win32::Security::Credentials::{
            CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
        };
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        if unsafe {
            CredReadW(
                self.target().as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut credential,
            )
        } == 0
        {
            return if std::io::Error::last_os_error().raw_os_error() == Some(1168) {
                Ok(None) // ERROR_NOT_FOUND only
            } else {
                Err(unavailable())
            };
        }
        let entry = unsafe { &*credential };
        let result = if entry.CredentialBlobSize == 32 && !entry.CredentialBlob.is_null() {
            decode_key(unsafe { std::slice::from_raw_parts(entry.CredentialBlob, 32) }).map(Some)
        } else {
            Err(unavailable())
        };
        unsafe {
            CredFree(credential.cast());
        }
        result
    }
    fn create(&self, key: &MasterKey) -> Result<(), AppError> {
        use windows_sys::Win32::Security::Credentials::{
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
        };
        if self.read()?.is_some() {
            return Err(unavailable());
        }
        let target = self.target();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr() as *mut u16,
            CredentialBlobSize: 32,
            CredentialBlob: key.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            Err(unavailable())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl KeyStore for NativeKeyStore {
    fn read(&self) -> Result<Option<MasterKey>, AppError> {
        Err(unavailable())
    }
    fn create(&self, _key: &MasterKey) -> Result<(), AppError> {
        Err(unavailable())
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
mod native_tests {
    use super::*;

    struct SyntheticEntry(NativeKeyStore);
    impl Drop for SyntheticEntry {
        fn drop(&mut self) {
            #[cfg(target_os = "macos")]
            {
                let _ = security_framework::passwords::delete_generic_password(
                    SERVICE,
                    &self.0.account,
                );
            }
            #[cfg(target_os = "windows")]
            unsafe {
                use windows_sys::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
                CredDeleteW(self.0.target().as_ptr(), CRED_TYPE_GENERIC, 0);
            }
        }
    }

    /// Explicit opt-in only; never opens the application account or any user credential.
    #[test]
    #[ignore = "opt-in synthetic OS credential smoke test; may prompt the user"]
    fn native_synthetic_master_key_round_trip() {
        let entry = SyntheticEntry(NativeKeyStore {
            account: format!("synthetic-test-{}", random_id().unwrap()),
        });
        assert!(entry.0.read().unwrap().is_none());
        let key = master(&entry.0, true).unwrap();
        let bytes = encrypt(&key, "synthetic", b"synthetic-not-a-user-secret").unwrap();
        let restored = master(&entry.0, false).unwrap();
        assert_eq!(
            &*decrypt(&restored, "synthetic", &bytes).unwrap(),
            b"synthetic-not-a-user-secret"
        );
        // Drop removes even on assertion failure. Explicitly verify cleanup on success.
        let account = entry.0.account.clone();
        drop(entry);
        assert!(NativeKeyStore { account }.read().unwrap().is_none());
    }
}
