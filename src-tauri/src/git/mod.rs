mod command;
pub mod commands;
mod contracts;
// 房间的产物快照从这里进来；工作区级 diff 不经过逐文件的预览入口。
pub(crate) use diff::workspace as workspace_diff;
mod diff;
mod status;
mod status_parser;
pub mod worktrees;

#[cfg(test)]
mod fixtures;
#[cfg(test)]
mod safety_tests;
#[cfg(test)]
mod tests;
