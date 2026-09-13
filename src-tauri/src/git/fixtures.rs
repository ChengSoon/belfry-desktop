use std::path::PathBuf;
use std::process::Command;

pub(super) struct Repository {
    pub root: PathBuf,
}

impl Repository {
    pub fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-git-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&root).unwrap();
        let repo = Self { root };
        repo.git(&["init", "--initial-branch=main"]);
        repo.git(&["config", "user.name", "Belfry test"]);
        repo.git(&["config", "user.email", "test@example.invalid"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    pub fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = self.try_git(args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    pub fn try_git(&self, args: &[&str]) -> std::process::Output {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        output
    }

    pub fn write(&self, name: &str, content: impl AsRef<[u8]>) {
        let path = self.root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    pub fn commit(&self) {
        self.git(&["add", "."]);
        self.git(&["commit", "-m", "fixture"]);
    }
    pub fn path(&self) -> &str {
        self.root.to_str().unwrap()
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
