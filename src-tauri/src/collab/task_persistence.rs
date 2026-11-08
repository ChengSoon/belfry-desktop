//! 持久任务表；受理、排队、写入意图和 submitted 回执各自提交后才返回。
use super::{CollabTask, DeliveryPhase, DeliveryReceipt, TaskState, short_id};
use crate::atomic::{FileLock, read_text_optional, write_atomic};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardFile { version: u32, revision: u64, tasks: Vec<CollabTask> }

#[derive(Default)]
struct Inner { tasks: HashMap<String, CollabTask>, root: Option<PathBuf>, revision: u64, error: Option<String> }

#[derive(Default)]
pub struct TaskBoard { inner: Mutex<Inner> }

impl TaskBoard {
    pub fn load(root: Option<PathBuf>) -> Self {
        let mut inner = Inner { root: root.clone(), ..Inner::default() };
        let loaded = root.as_ref().ok_or_else(|| belfry_i18n::text("找不到任务存储目录").to_string()).and_then(|root| {
            let _writer = FileLock::acquire(&root.join("tasks.lock")).map_err(|error| error.message)?;
            read(root)
        });
        match loaded {
            Ok(file) => { inner.revision = file.revision; inner.tasks = file.tasks.into_iter().map(|task| (task.id.clone(), task)).collect(); }
            Err(error) => inner.error = Some(error),
        }
        let board = Self { inner: Mutex::new(inner) };
        if board.load_error().is_none() {
            let changed = board.snapshot().iter().any(|task| task.state == TaskState::Queued && (task.delivery.attempt_id.is_some() || task.delivery.phase == DeliveryPhase::Submitting));
            if changed && let Err(error) = board.edit(|tasks| {
                for task in tasks.values_mut().filter(|task| task.state == TaskState::Queued) {
                    match task.delivery.phase {
                        DeliveryPhase::Submitting => {
                            task.delivery.phase = DeliveryPhase::Uncertain;
                            task.delivery.message = Some(belfry_i18n::text("应用在提交期间重启，无法确认是否已进入终端；未自动重复投递。").into());
                        }
                        DeliveryPhase::Accepted | DeliveryPhase::Queued => task.delivery = DeliveryReceipt::default(),
                        _ => {}
                    }
                }
                Ok(())
            }) { board.inner.lock().unwrap().error = Some(error); }
        }
        board
    }

    pub fn load_error(&self) -> Option<String> { self.inner.lock().ok().and_then(|inner| inner.error.clone()) }

    pub(super) fn edit<T>(&self, action: impl FnOnce(&mut HashMap<String, CollabTask>) -> Result<T, String>) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|_| belfry_i18n::text("任务表锁不上"))?;
        if let Some(error) = &inner.error { return Err(error.clone()); }
        let mut tasks = inner.tasks.clone();
        let result = action(&mut tasks)?;
        if let Some(root) = &inner.root {
            let _writer = FileLock::acquire(&root.join("tasks.lock")).map_err(|error| error.message)?;
            let current = read(root)?;
            if current.revision != inner.revision { return Err(belfry_i18n::text("任务表已被另一实例更新，请重新加载；本次操作未提交。").into()); }
            if tasks == inner.tasks { return Ok(result); }
            let revision = inner.revision.checked_add(1).ok_or(belfry_i18n::text("任务版本溢出"))?;
            let mut entries: Vec<_> = tasks.values().cloned().collect();
            entries.sort_by(|left, right| left.id.cmp(&right.id));
            let file = BoardFile { version: 1, revision, tasks: entries };
            let text = serde_json::to_string(&file).map_err(|error| error.to_string())?;
            write_atomic(&root.join("tasks.json"), &text, true).map_err(|error| error.message)?;
            inner.revision = revision;
        }
        inner.tasks = tasks;
        Ok(result)
    }

    pub fn insert(&self, task: CollabTask) -> Result<(), String> {
        self.edit(|tasks| {
            if tasks.values().any(|existing| short_id(&existing.id) == short_id(&task.id)) { return Err(belfry_i18n::text("任务编号重复，未创建任务").into()); }
            tasks.insert(task.id.clone(), task);
            Ok(())
        })
    }

    #[cfg(test)]
    pub fn get(&self, id: &str) -> Option<CollabTask> { self.inner.lock().ok()?.tasks.get(id).cloned() }

    pub fn snapshot(&self) -> Vec<CollabTask> { self.inner.lock().map(|inner| inner.tasks.values().cloned().collect()).unwrap_or_default() }

    pub fn pending(&self) -> Vec<CollabTask> {
        if self.load_error().is_some() { return Vec::new(); }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
        let mut pending: Vec<_> = self.snapshot().into_iter().filter(|task| task.state == TaskState::Queued
            && matches!(task.delivery.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued) && task.due_at <= now).collect();
        pending.sort_by_key(|task| task.created_at);
        pending
    }

    pub fn claim_delivery(&self, id: &str, attempt: &str) -> Result<bool, String> {
        if attempt.is_empty() || attempt.len() > 128 || !attempt.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') { return Err(belfry_i18n::text("投递回执编号无效").into()); }
        self.edit(|tasks| {
            let Some(task) = tasks.get_mut(id) else { return Ok(false); };
            if task.state != TaskState::Queued || !matches!(task.delivery.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued) { return Ok(false); }
            if let Some(owner) = &task.delivery.attempt_id { return Ok(owner == attempt); }
            task.delivery.attempt_id = Some(attempt.into());
            Ok(true)
        })
    }

    pub fn release_delivery(&self, id: &str, attempt: &str) -> Result<(), String> {
        self.edit(|tasks| {
            if let Some(task) = tasks.get_mut(id) && task.delivery.attempt_id.as_deref() == Some(attempt)
                && matches!(task.delivery.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued) {
                task.delivery = DeliveryReceipt::default();
            }
            Ok(())
        })
    }

    pub fn delivery_update(&self, id: &str, attempt: &str, sequence: u64, phase: DeliveryPhase, message: Option<String>) -> Result<bool, String> {
        if message.as_ref().is_some_and(|message| message.len() > 4096) { return Err(belfry_i18n::text("投递说明超过限制").into()); }
        self.edit(|tasks| {
            let Some(task) = tasks.get_mut(id) else { return Ok(false); };
            if task.delivery.attempt_id.as_deref() != Some(attempt) { return Ok(false); }
            // beforeSend 的幂等确认不能授权已取消、已提交或不确定的任务再写一次。
            if phase == DeliveryPhase::Submitting && (task.state != TaskState::Queued
                || !matches!(task.delivery.phase, DeliveryPhase::Accepted | DeliveryPhase::Queued | DeliveryPhase::Submitting)) {
                return Ok(false);
            }
            if phase == DeliveryPhase::Submitting && sequence <= task.delivery.sequence {
                return Ok(sequence == task.delivery.sequence && task.delivery.phase == DeliveryPhase::Submitting);
            }
            if sequence <= task.delivery.sequence { return Ok(true); }
            // submitted 之后的旧 queued/attention 不能回滚事实；取消后不能再次开始写入。
            if task.delivery.phase == DeliveryPhase::Submitted { return Ok(true); }
            if super::is_settled(&task.state) && phase != DeliveryPhase::Submitted { return Ok(false); }
            if phase == DeliveryPhase::Submitted && !matches!(task.delivery.phase, DeliveryPhase::Submitting | DeliveryPhase::Uncertain) {
                return Err(belfry_i18n::text("缺少已持久化的提交意图，不能把排队标为已提交").into());
            }
            if phase == DeliveryPhase::Accepted { return Err(belfry_i18n::text("请使用释放投递接口").into()); }
            task.delivery.phase = phase;
            task.delivery.sequence = sequence;
            task.delivery.message = message;
            if phase == DeliveryPhase::Submitted && !super::is_settled(&task.state) { task.state = TaskState::Dispatched; }
            if phase == DeliveryPhase::Cancelled && !super::is_settled(&task.state) { task.state = TaskState::Abandoned; }
            Ok(true)
        })
    }

    #[cfg(test)]
    pub fn mark_dispatched(&self, id: &str) {
        let _ = self.claim_delivery(id, "test-receipt");
        let _ = self.delivery_update(id, "test-receipt", 1, DeliveryPhase::Submitting, None);
        let _ = self.delivery_update(id, "test-receipt", 2, DeliveryPhase::Submitted, None);
    }

    /// 人工操作使用面板读到的原序号做 CAS；不能复用自动回执的幂等确认语义。
    pub fn resolve_delivery(&self, id: &str, attempt: &str, expected_sequence: u64, submitted: bool) -> Result<(), String> {
        self.edit(|tasks| {
            let task = tasks.get_mut(id).ok_or("The delivery has changed. Refresh the task panel.")?;
            if task.delivery.phase != DeliveryPhase::Uncertain || task.delivery.attempt_id.as_deref() != Some(attempt)
                || task.delivery.sequence != expected_sequence {
                return Err("The delivery has changed. Refresh the task panel.".into());
            }
            task.delivery.sequence = expected_sequence.checked_add(1).ok_or("Delivery sequence overflow.")?;
            task.delivery.phase = if submitted { DeliveryPhase::Submitted } else { DeliveryPhase::Cancelled };
            task.delivery.message = Some(if submitted { "User confirmed submission in the target terminal." }
                else { "User abandoned an uncertain delivery. It will not be resubmitted automatically." }.into());
            if !super::is_settled(&task.state) {
                task.state = if submitted { TaskState::Dispatched } else { TaskState::Abandoned };
            }
            Ok(())
        })
    }

    pub fn settle(&self, id: &str, claimant: &str, state: TaskState, result: Option<String>) -> Result<CollabTask, String> {
        self.edit(|tasks| {
            let task = tasks.get_mut(id).ok_or_else(|| belfry_i18n::lformat!("没有编号 {id} 的任务"))?;
            if task.to != claimant { return Err(belfry_i18n::text("这条任务不是派给你的").into()); }
            if matches!(task.state, TaskState::Done | TaskState::Failed) { return Err(belfry_i18n::text("这条任务已经结了").into()); }
            task.state = state; task.result = result;
            Ok(task.clone())
        })
    }

    pub fn remove(&self, id: &str) -> Result<(), String> { self.edit(|tasks| { tasks.remove(id); Ok(()) }) }

    pub fn approve(&self, id: &str) -> Result<CollabTask, String> {
        self.edit(|tasks| {
            let task = tasks.get_mut(id).ok_or_else(|| belfry_i18n::lformat!("没有编号 {id} 的任务"))?;
            if task.state != TaskState::PendingApproval { return Err(belfry_i18n::text("这条任务不在等确认").into()); }
            task.state = TaskState::Queued;
            Ok(task.clone())
        })
    }
    pub fn reject(&self, id: &str) -> Result<CollabTask, String> {
        self.edit(|tasks| {
            let task = tasks.get_mut(id).ok_or_else(|| belfry_i18n::lformat!("没有编号 {id} 的任务"))?;
            if task.state != TaskState::PendingApproval { return Err(belfry_i18n::text("这条任务不在等确认").into()); }
            cancel(task, belfry_i18n::text("用户拒绝了这条派活"));
            Ok(task.clone())
        })
    }
    pub fn stop_all(&self) -> Result<usize, String> {
        self.edit(|tasks| {
            let mut count = 0;
            for task in tasks.values_mut().filter(|task| !super::is_settled(&task.state)) {
                if task.chat.is_none() { count += 1; }
                cancel(task, belfry_i18n::text("用户中止了协作"));
            }
            Ok(count)
        })
    }
    pub fn abandon_for(&self, tab_id: &str) -> Result<(), String> {
        self.edit(|tasks| {
            for task in tasks.values_mut().filter(|task| task.to == tab_id && !super::is_settled(&task.state)) { cancel(task, belfry_i18n::text("目标会话已关闭")); }
            Ok(())
        })
    }
    pub fn count_in_path(&self, root: &str) -> usize {
        self.snapshot().iter().filter(|task| task.chat.is_none() && task.path.first().is_some_and(|first| first == root)).count()
    }
}

fn cancel(task: &mut CollabTask, reason: &str) {
    task.state = TaskState::Abandoned;
    task.result = Some(reason.into());
    if !matches!(task.delivery.phase, DeliveryPhase::Submitted | DeliveryPhase::Submitting | DeliveryPhase::Uncertain) { task.delivery.phase = DeliveryPhase::Cancelled; }
    else if task.delivery.phase == DeliveryPhase::Submitting { task.delivery.phase = DeliveryPhase::Uncertain; }
    task.delivery.message = Some(reason.into());
}

fn read(root: &Path) -> Result<BoardFile, String> {
    let text = read_text_optional(&root.join("tasks.json")).map_err(|error| error.message)?;
    if text.trim().is_empty() { return Ok(BoardFile { version: 1, ..BoardFile::default() }); }
    let file: BoardFile = serde_json::from_str(&text).map_err(|error| belfry_i18n::lformat!("任务文件无效，已保留现场：{error}"))?;
    if file.version != 1 { return Err(belfry_i18n::text("任务文件版本不支持，已按只读处理").into()); }
    Ok(file)
}
