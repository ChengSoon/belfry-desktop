mod claude;
mod client;
mod codex;
pub mod commands;
mod contracts;
mod diagnostics;
mod migration;
mod native;
mod pi;
pub(crate) mod process;

pub(crate) fn migrate_collaboration_on_startup() {
    for result in migration::migrate_all() {
        if result.state.is_err() {
            log::warn!(
                "A legacy collaboration skill was preserved because migration could not inspect or remove it"
            );
        }
    }
}
