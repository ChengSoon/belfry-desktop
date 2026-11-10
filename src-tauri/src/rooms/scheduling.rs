//! The same responsibility-first context accompanies coordinator messages and room status.
use super::model::*;
use crate::collab::SessionRegistry;

pub fn context(room: &Room, registry: Option<&SessionRegistry>) -> String {
    let mut lines = vec![belfry_i18n::text(
        "派活规则：先按任务目标匹配职责，再在匹配成员中考虑负载、会话状态和前置依赖；空闲本身不是派活理由。用户明确指定负责人时优先遵从，不静默改派；跨职责工作拆成任务，由统筹集成；没有合适成员时说明缺口。只用任务板派活，派活前用 belfry room status 核对最新职责与已有任务，避免重复创建。"
    ).to_string(), belfry_i18n::text("当前在场成员（本次快照；任意自定义职责，不按 Agent 类型分工）").to_string()];
    for member in room.active_members() {
        let duty = if member.duty.trim().is_empty() {
            belfry_i18n::text("未写职责")
        } else {
            member.duty.as_str()
        };
        let role = if member.role == MemberRole::Foreman {
            belfry_i18n::text("统筹")
        } else {
            belfry_i18n::text("成员")
        };
        let activity = registry
            .map(|registry| {
                registry
                    .find(&member.tab_id)
                    .map(|session| session.activity)
                    .unwrap_or_else(|| "offline".into())
            })
            .unwrap_or_else(|| belfry_i18n::text("会话状态请查 room status").into());
        let tasks = room
            .tasks
            .iter()
            .filter(|task| {
                task.assignee.as_deref() == Some(member.id.as_str())
                    && matches!(task.status, TaskStatus::Planned | TaskStatus::Active)
            })
            .map(|task| task.id.as_str())
            .collect::<Vec<_>>();
        let task_ids = if tasks.is_empty() {
            belfry_i18n::text("无").to_string()
        } else {
            tasks.join(", ")
        };
        lines.push(belfry_i18n::lformat!(
            "- {title}（成员ID：{id}，{role}，Agent：{agent}）；职责：{duty}；未完成任务：{count}（{task_ids}）；会话：{activity}",
            title = member.title, id = member.id, agent = member.agent, count = tasks.len()
        ));
    }
    let tasks = room
        .tasks
        .iter()
        .filter(|task| matches!(task.status, TaskStatus::Planned | TaskStatus::Active))
        .collect::<Vec<_>>();
    if !tasks.is_empty() {
        lines.push(belfry_i18n::text("现有未完成任务（详情和全部任务见 room status）").into());
        for task in tasks.iter().take(20) {
            let owner = task
                .assignee
                .as_deref()
                .unwrap_or_else(|| belfry_i18n::text("未分配"));
            let blockers = open_blockers(room, task);
            let waiting = if blockers.is_empty() {
                belfry_i18n::text("无").to_string()
            } else {
                blockers.join(", ")
            };
            lines.push(belfry_i18n::lformat!(
                "- {id}「{title}」：{status}；负责人ID：{owner}；等待：{waiting}",
                id = task.id,
                title = excerpt(&task.title, 80),
                status = task.status.label()
            ));
        }
        if tasks.len() > 20 {
            lines.push(belfry_i18n::lformat!(
                "另有 {} 项，请读取完整任务板。",
                tasks.len() - 20
            ));
        }
    }
    lines.push(belfry_i18n::text("task add --to / task assign 可用当前角色名或完整成员ID；角色名可能被重用，旧成员ID失效时不要自动改投同名新人。").into());
    lines.join("\n")
}
