import type { SshTarget } from "../../terminal/contracts";

export const SSH_HOSTS_KEY = "belfry.ssh-hosts.v1";
export const SSH_HOSTS_EVENT = "belfry:ssh-hosts-changed";
export const MAX_HOSTS = 200;
export const MAX_HOSTS_BYTES = 1_000_000;
export const MAX_REMOTE_PATH = 4_096;

export interface HostProfile { id: string; name: string; group: string; target: SshTarget }
export interface HostCatalog { version: 1; entries: HostProfile[] }
export interface HostLoad { catalog: HostCatalog; raw: string | null; error: string | null }
export interface SshAlias { name: string; source: string }
export interface AliasReport { aliases: SshAlias[]; warnings: string[] }
export interface RemoteReport { path: string; directories: string[]; truncated: boolean }
export interface ProbeRequest { id: string; target: SshTarget; browse: boolean }
