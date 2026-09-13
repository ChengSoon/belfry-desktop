use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant}};
use crate::{git::command, terminal::AppError};
use super::{actions::{self, PlannedAction}, contracts::*, repository as repo, snapshot, store};

const PREVIEW_TTL: Duration = Duration::from_secs(600);
const MAX_PREVIEWS: usize = 8;
enum Plan { Create(ManagedWorktree), Action(PlannedAction) }
pub struct WorktreeService { data: PathBuf, plans: HashMap<String, (Instant, Plan)> }
#[derive(Default)] pub struct WorktreeState(pub Mutex<Option<WorktreeService>>);

impl WorktreeService {
    pub fn new(data: PathBuf) -> Self { Self { data, plans: HashMap::new() } }

    pub fn list(&self, path: &str) -> Result<WorktreeReport, AppError> {
        let (repository, mut report) = repo::report(path)?;
        report.managed = store::load(&self.data)?.into_iter()
            .filter(|tree| tree.common_dir == repository.common && tree.state != "removed").collect();
        Ok(report)
    }

    pub fn preview(&mut self, input: CreateInput) -> Result<WorktreePreview, AppError> {
        let repository = repo::inspect(&input.root_path)?;
        let name = validate_name(&input.name)?;
        repo::validate_branch(&repository.root, &input.branch)?;
        let base_head = repo::branch_head(&repository.root, &input.base_branch)?;
        let id = ulid::Ulid::generate().to_string().to_lowercase();
        let tree = ManagedWorktree { id: id.clone(), name, root_path: self.data.join("trees").join(id).to_string_lossy().into_owned(),
            repository_path: repository.root.to_string_lossy().into_owned(), common_dir: repository.common,
            branch: input.branch, base_branch: input.base_branch, base_head, state: "creating".into() };
        assert_new(&tree, &store::load(&self.data)?)?;
        let mut notes = dependency_hints(&repository.root);
        notes.insert(0, format!("从 {} 的已提交内容创建；当前未提交文件不会复制。", tree.base_branch));
        let mut preview = WorktreePreview { token: String::new(), title: format!("创建任务「{}」", tree.name),
            root_path: tree.root_path.clone(), branch: tree.branch.clone(), target_path: None, files: vec![], diff: String::new(), notes };
        preview.token = self.remember(Plan::Create(tree));
        Ok(preview)
    }

    pub fn preview_action(&mut self, input: ActionInput) -> Result<WorktreePreview, AppError> {
        let tree = store::load(&self.data)?.into_iter().find(|tree| tree.id == input.id && tree.state != "removed")
            .ok_or_else(|| AppError::invalid_argument("只能操作 Belfry 创建的受管 Worktree"))?;
        let plan = actions::prepare(tree, input)?;
        let title = match plan.action { Action::Commit => "提交任务全部变更", Action::Merge => "合并到目标分支", Action::Cleanup => "清理工作树目录" };
        let diff = review_diff(&plan)?;
        let mut notes = match plan.action {
            Action::Commit => vec![format!("提交说明：{}", plan.message), "包含列表中的全部变更；向导不执行 Git Hook 或签名。".into()],
            Action::Merge => vec![format!("合并提交：{}", plan.source.head), "冲突时停在目标目录，保留全部成果。".into()],
            Action::Cleanup => vec!["仅移除任务目录，保留分支。请先关闭在此目录运行的外部终端或编辑器。".into()],
        };
        if let Some((_, target)) = &plan.target { notes.insert(0, format!("目标分支：{} · {}", target.branch, target.head)); }
        let mut preview = WorktreePreview { token: String::new(), title: title.into(), root_path: plan.tree.root_path.clone(),
            branch: plan.tree.branch.clone(), target_path: plan.target.as_ref().map(|(path, _)| path.clone()),
            files: plan.source.files.clone(), diff, notes };
        preview.token = self.remember(Plan::Action(plan));
        Ok(preview)
    }

    pub fn execute(&mut self, token: &str, busy: impl Fn(&Path) -> bool) -> Result<ActionResult, AppError> {
        let (created, plan) = self.plans.remove(token).ok_or_else(|| AppError::invalid_argument("预览已失效或已执行，请重新预览"))?;
        if created.elapsed() > PREVIEW_TTL { return Err(AppError::invalid_argument("预览已过期，请重新预览")); }
        let _lock = store::RegistryLock::acquire(&self.data)?;
        match plan {
            Plan::Create(tree) => self.create(tree),
            Plan::Action(plan) => {
                let id = plan.tree.id.clone();
                let mut records = store::load(&self.data)?;
                if !records.iter().any(|tree| tree.id == id && tree.state != "removed") { return Err(AppError::invalid_argument("Worktree 所有权记录已变化")); }
                let result = actions::execute(plan, &busy)?;
                if let Some(tree) = &result.worktree { if let Some(record) = records.iter_mut().find(|entry| entry.id == id) { *record = tree.clone(); } }
                store::save(&self.data, records)?;
                Ok(result)
            }
        }
    }

    fn create(&self, mut tree: ManagedWorktree) -> Result<ActionResult, AppError> {
        let mut records = store::load(&self.data)?;
        assert_new(&tree, &records)?;
        let repository = repo::inspect(&tree.repository_path)?;
        if repository.common != tree.common_dir || repo::branch_head(&repository.root, &tree.base_branch)? != tree.base_head {
            return Err(AppError::invalid_argument("预览后基础分支已变化，请重新预览"));
        }
        std::fs::create_dir_all(self.data.join("trees")).map_err(|error| AppError::io(error.to_string()))?;
        records.push(tree.clone()); store::save(&self.data, records.clone())?;
        let result = repo::mutation(&repository.root, &["worktree", "add", "-b", &tree.branch, "--", &tree.root_path, &tree.base_head]);
        match result.and_then(repo::success) {
            Ok(()) => tree.state = "ready".into(),
            Err(error) => { tree.state = "incomplete".into(); update(&mut records, &tree); store::save(&self.data, records)?; return Err(error); }
        }
        update(&mut records, &tree); store::save(&self.data, records)?;
        Ok(ActionResult { message: "独立任务目录已创建，可打开为新会话。".into(), worktree: Some(tree), conflicts: vec![] })
    }

    fn remember(&mut self, plan: Plan) -> String {
        self.plans.retain(|_, (created, _)| created.elapsed() < PREVIEW_TTL);
        if self.plans.len() >= MAX_PREVIEWS { self.plans.clear(); }
        let token = ulid::Ulid::generate().to_string();
        self.plans.insert(token.clone(), (Instant::now(), plan)); token
    }
}

fn update(records: &mut [ManagedWorktree], tree: &ManagedWorktree) {
    if let Some(record) = records.iter_mut().find(|entry| entry.id == tree.id) { *record = tree.clone(); }
}

fn assert_new(tree: &ManagedWorktree, entries: &[ManagedWorktree]) -> Result<(), AppError> {
    if entries.iter().any(|entry| entry.common_dir == tree.common_dir && entry.state != "removed"
        && (entry.name.to_lowercase() == tree.name.to_lowercase() || entry.branch == tree.branch)) {
        return Err(AppError::invalid_argument("任务名称或分支已经存在"));
    }
    if std::fs::symlink_metadata(&tree.root_path).is_ok() { return Err(AppError::invalid_argument("目标目录已经存在，不能覆盖")); }
    let output = command::run(Path::new(&tree.repository_path), &["show-ref", "--verify", "--quiet", &format!("refs/heads/{}", tree.branch)], repo::READ_LIMIT)?;
    if output.status.success() { return Err(AppError::invalid_argument("目标分支已经存在，请使用新分支")); }
    if output.status.code() != Some(1) { return Err(AppError::io("无法核对目标分支是否存在")); }
    Ok(())
}

fn validate_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    let reserved = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || name.chars().count() > 60 || name.starts_with('-') || name.ends_with('.')
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) || name.chars().any(char::is_control)
        || ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1", ".", ".."].contains(&reserved.as_str()) {
        return Err(AppError::invalid_argument("任务名称无效，最多 60 字且不能包含路径符号"));
    }
    Ok(name.into())
}

fn dependency_hints(root: &Path) -> Vec<String> {
    let mut hints = vec!["依赖不会自动安装；可在任务终端中按项目文档初始化。".into()];
    for (file, command) in [("pnpm-lock.yaml", "pnpm install"), ("package-lock.json", "npm ci"), ("yarn.lock", "yarn install"), ("Cargo.toml", "cargo check")] {
        if root.join(file).is_file() { hints.push(format!("检测到 {file}，可按需执行：{command}")); }
    }
    hints
}

fn review_diff(plan: &PlannedAction) -> Result<String, AppError> {
    if plan.action == Action::Commit { return Ok(snapshot::preview(&plan.source)); }
    if plan.action == Action::Cleanup { return Ok(String::new()); }
    let (_, target) = plan.target.as_ref().expect("merge target");
    let range = format!("{}...{}", target.head, plan.source.head);
    let root = Path::new(&plan.tree.root_path);
    let log = repo::text(root, &["log", "--oneline", &format!("{}..{}", target.head, plan.source.head)])?;
    let diff = repo::text(root, &["diff", "--no-ext-diff", "--no-textconv", "--no-color", &range, "--"])?;
    Ok(format!("将合并的提交\n{log}\n相对共同基础的变更\n{diff}"))
}
