use std::process::Command;

#[cfg(target_os = "macos")]
#[test]
fn regression_cli_does_not_load_locale_frameworks_before_its_deadline_clock_starts() {
    let output = Command::new("/usr/bin/otool").args(["-L", env!("CARGO_BIN_EXE_belfry")]).output().unwrap();
    assert!(output.status.success());
    let libraries = String::from_utf8(output.stdout).unwrap();
    assert!(!libraries.contains("CoreFoundation.framework"), "System locale lookup must load its framework on demand, after main starts the wait deadline: {libraries}");
}

#[test]
fn regression_english_help_works_without_an_application_session() {
    let output = Command::new(env!("CARGO_BIN_EXE_belfry"))
        .env("BELFRY_LANG", "en").env_remove("BELFRY_TAB_ID").arg("--help").output().unwrap();
    assert!(output.status.success(), "--help must succeed without an application session");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("belfry room task"));
    assert!(text.contains("Collaboration commands"), "{text}");
    assert!(!text.chars().any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch)), "English help must not contain untranslated Chinese: {text}");
}

#[test]
fn chinese_help_is_selected_explicitly() {
    let output = Command::new(env!("CARGO_BIN_EXE_belfry"))
        .env("BELFRY_LANG", "zh-CN").env_remove("BELFRY_TAB_ID").arg("--help").output().unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout).unwrap().contains("协作命令"));
}

#[test]
fn saved_app_language_is_used_unless_the_environment_overrides_it() {
    let root = std::env::temp_dir().join(format!("belfry-cli-locale-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("locale.json");
    std::fs::write(&path, r#"{"version":1,"locale":"en"}"#).unwrap();
    let help = |explicit: Option<&str>| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_belfry"));
        command.env("BELFRY_LOCALE_FILE", &path).env_remove("BELFRY_LANG").arg("--help");
        if let Some(locale) = explicit { command.env("BELFRY_LANG", locale); }
        let output = command.output().unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap()
    };
    assert!(help(None).contains("Collaboration commands"));
    assert!(help(Some("zh-CN")).contains("协作命令"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn english_argument_errors_and_room_usage_have_no_untranslated_templates() {
    for args in [vec!["send"], vec!["room", "say"], vec!["room", "task", "assign", "T1"], vec!["wait", "T1", "--timeout", "bad"], vec!["room", "unknown"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_belfry"))
            .env("BELFRY_LANG", "en").args(&args).output().unwrap();
        assert!(!output.status.success());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty());
        assert!(!error.chars().any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch)), "{args:?}: {error}");
    }
}
