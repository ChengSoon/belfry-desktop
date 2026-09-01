mod codex;
pub mod commands;
mod contracts;
mod diagnostics;
mod skill;

pub(crate) fn install_skill_on_startup() {
    // Skill 是增强功能：用户目录不可写时不能阻止终端工作台启动。
    let _ = skill::install();
}
