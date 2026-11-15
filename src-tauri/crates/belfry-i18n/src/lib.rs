mod catalog;
mod locale;
mod system_locale;
extern crate self as belfry_i18n;

pub use catalog::{ErrorText, error_message, error_text, localize, text};
pub use locale::{Locale, current, initialize_app, initialize_cli, preference_path, resolve, set_current, with_locale};

/// Compiles both language templates with Rust's format checking; user values are never reparsed.
pub use belfry_i18n_macros::lformat;

#[cfg(test)]
mod formatting_tests {
    #[test]
    fn regression_delimiters_inside_user_parameters_are_never_reparsed() {
        crate::with_locale(crate::Locale::En, || {
            let room = "alpha」，角色「beta";
            let duty = "custom responsibility";
            let objective = "custom objective";
            let role = "custom role";
            let output = crate::lformat!("房间「{}」·角色「{}」\n职责：{duty}\n目标：{objective}\n{role}\n任务须显式交差。", room, "Lead");
            assert_eq!(output, format!("Room \"{room}\" · Role \"Lead\"\nResponsibilities: {duty}\nObjective: {objective}\n{role}\nReport task completion explicitly."));
        });
    }
}
