mod cancel;
mod claude;
mod codex;
pub mod commands;
pub mod contracts;
mod cursor;
mod dedup;
mod parser;
mod patch;
mod reader;
mod snapshot;
mod sources;
mod state;
mod text;

pub use state::HistoryDetailState;

#[cfg(test)]
mod parser_tests;

#[cfg(test)]
mod boundary_tests;
#[cfg(test)]
mod fixtures;
#[cfg(test)]
mod native_smoke;
#[cfg(test)]
mod reader_tests;
