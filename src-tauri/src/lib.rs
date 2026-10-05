use serde::{Deserialize, Serialize};
use std::{fs, io::Write, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Browser {
    Default,
    Chrome,
    Edge,
    Firefox,
    Safari,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Action {
    Webmail { browser: Browser, url: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct TaskButton {
    id: String,
    name: String,
    action: Action,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Settings {
    version: u32,
    buttons: Vec<TaskButton>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SettingsChange {
    Add { button: TaskButton },
    Update { button: TaskButton },
    Delete { id: String },
    Move { id: String, direction: Direction },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Up,
    Down,
}

fn apply_settings_change(settings: &mut Settings, change: SettingsChange) -> Result<(), String> {
    let id = match &change {
        SettingsChange::Add { button } | SettingsChange::Update { button } => &button.id,
        SettingsChange::Delete { id } | SettingsChange::Move { id, .. } => id,
    };
    let index = settings.buttons.iter().position(|button| &button.id == id);
    if let SettingsChange::Add { button } = change {
        if index.is_some() {
            return Err("Button already exists.".into());
        }
        settings.buttons.push(button);
    } else {
        let index = index.ok_or("Button no longer exists.")?;
        match change {
            SettingsChange::Update { button } => settings.buttons[index] = button,
            SettingsChange::Delete { .. } => {
                settings.buttons.remove(index);
            }
            SettingsChange::Move { direction, .. } => {
                let target = match direction {
                    Direction::Up => index.checked_sub(1),
                    Direction::Down => Some(index + 1),
                }
                .filter(|target| *target < settings.buttons.len())
                .ok_or("Button cannot move further in that direction.")?;
                settings.buttons.swap(index, target);
            }
            SettingsChange::Add { .. } => unreachable!(),
        }
    }
    validate(settings)
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            buttons: [
                ("outlook", "Work email", "https://outlook.office.com/mail/"),
                ("gmail", "Gmail", "https://mail.google.com/"),
                (
                    "hotmail",
                    "Personal email",
                    "https://outlook.live.com/mail/",
                ),
            ]
            .into_iter()
            .map(|(id, name, url)| TaskButton {
                id: id.into(),
                name: name.into(),
                action: Action::Webmail {
                    browser: Browser::Default,
                    url: url.into(),
                },
            })
            .collect(),
        }
    }
}

fn validate(settings: &Settings) -> Result<(), String> {
    if settings.version != 1 {
        return Err("Unsupported settings version.".into());
    }
    if settings.buttons.len() > 100 {
        return Err("A maximum of 100 buttons is supported.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for button in &settings.buttons {
        if button.id.is_empty() || button.id.len() > 100 || !ids.insert(&button.id) {
            return Err("Button IDs must be unique and nonempty.".into());
        }
        if button.name.trim().is_empty() || button.name.chars().count() > 80 {
            return Err("Use a button name between 1 and 80 characters.".into());
        }
        let Action::Webmail { url, browser } = &button.action;
        if url.len() > 2048 {
            return Err("The web address is too long.".into());
        }
        let parsed = url::Url::parse(url).map_err(|_| "Enter a valid HTTPS web address.")?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Use an HTTPS web address without embedded credentials.".into());
        }
        if !cfg!(target_os = "macos") && matches!(browser, Browser::Safari) {
            return Err("Safari is only supported on macOS.".into());
        }
    }
    Ok(())
}

struct SettingsLock(Mutex<()>);
// This directory is a persistence contract: never rename it for a new release.
// Keep it separate from the bundle ID directory that NSIS can remove on uninstall.
const SETTINGS_DIRECTORY: &str = "com.hedwig.taskdashboard.settings";
const LEGACY_SETTINGS_DIRECTORY: &str = "com.hedwig.taskdashboard";

fn settings_paths(root: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf) {
    (
        root.join(SETTINGS_DIRECTORY).join("settings.json"),
        root.join(LEGACY_SETTINGS_DIRECTORY).join("settings.json"),
    )
}
fn config_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().config_dir().map_err(|e| e.to_string())
}
fn read_file(path: &std::path::Path) -> Result<Option<Settings>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let settings =
                serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read settings: {e}"))?;
            validate(&settings)?;
            Ok(Some(settings))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read settings: {e}")),
    }
}
fn write_settings(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    validate(settings)?;
    let parent = path.parent().ok_or("Settings directory is unavailable.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn read_settings_from(root: &std::path::Path) -> Result<Settings, String> {
    let (path, legacy) = settings_paths(root);
    if let Some(settings) = read_file(&path)? {
        return Ok(settings);
    }
    if let Some(settings) = read_file(&legacy)? {
        // Copy atomically before returning. Retain the old file for rollback;
        // a migration failure must never silently reset the dashboard.
        write_settings(&path, &settings)?;
        return Ok(settings);
    }
    Ok(Settings::default())
}
fn read_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    read_settings_from(&config_root(app)?)
}
fn change_settings_from(
    root: &std::path::Path,
    change: SettingsChange,
) -> Result<Settings, String> {
    let mut settings = read_settings_from(root)?;
    apply_settings_change(&mut settings, change)?;
    let (path, _) = settings_paths(root);
    write_settings(&path, &settings)?;
    Ok(settings)
}
#[tauri::command]
fn load_settings(
    app: tauri::AppHandle,
    lock: tauri::State<SettingsLock>,
) -> Result<Settings, String> {
    let _guard = lock.0.lock().map_err(|_| "Settings are unavailable.")?;
    read_settings(&app)
}
#[tauri::command]
fn change_settings(
    app: tauri::AppHandle,
    lock: tauri::State<SettingsLock>,
    change: SettingsChange,
) -> Result<Settings, String> {
    let _guard = lock.0.lock().map_err(|_| "Settings are unavailable.")?;
    // Keep the entire read-modify-write under the lock. A window only submits
    // its intended action, so stale snapshots cannot reset unrelated buttons.
    change_settings_from(&config_root(&app)?, change)
}
#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

#[cfg(target_os = "macos")]
fn launch(browser: &Browser, url: &str) -> Result<(), String> {
    if matches!(browser, Browser::Default) {
        return open::that(url).map_err(|e| e.to_string());
    }
    let app = match browser {
        Browser::Chrome => "Google Chrome",
        Browser::Edge => "Microsoft Edge",
        Browser::Firefox => "Firefox",
        Browser::Safari => "Safari",
        Browser::Default => unreachable!(),
    };
    let output = std::process::Command::new("/usr/bin/open")
        .args(["-a", app, url])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Could not open {app}. Check that it is installed."))
    }
}
#[cfg(target_os = "windows")]
fn launch(browser: &Browser, url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use winreg::{
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        RegKey,
    };
    if matches!(browser, Browser::Default) {
        return open::that(url).map_err(|e| e.to_string());
    }
    let exe = match browser {
        Browser::Chrome => "chrome.exe",
        Browser::Edge => "msedge.exe",
        Browser::Firefox => "firefox.exe",
        _ => return Err("Unsupported browser.".into()),
    };
    let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(&key, KEY_READ | view) {
                if let Ok(path) = key.get_value::<String, _>("") {
                    let path = path.trim_matches('"');
                    if std::path::Path::new(path).is_file() {
                        return std::process::Command::new(path)
                            .arg(url)
                            .creation_flags(0x08000000)
                            .spawn()
                            .map(|_| ())
                            .map_err(|e| e.to_string());
                    }
                }
            }
        }
    }
    Err(format!(
        "Could not find {exe}. Install the browser or choose System default."
    ))
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch(_browser: &Browser, _url: &str) -> Result<(), String> {
    Err("This app supports macOS and Windows.".into())
}

#[tauri::command]
fn launch_button(
    app: tauri::AppHandle,
    lock: tauri::State<SettingsLock>,
    id: String,
) -> Result<(), String> {
    let settings = {
        let _guard = lock.0.lock().map_err(|_| "Settings are unavailable.")?;
        read_settings(&app)?
    };
    let button = settings
        .buttons
        .iter()
        .find(|b| b.id == id)
        .ok_or("Button no longer exists.")?;
    let Action::Webmail { browser, url } = &button.action;
    launch(browser, url)
}

pub fn run() {
    tauri::Builder::default()
        .manage(SettingsLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            load_settings,
            change_settings,
            launch_button,
            platform
        ])
        .run(tauri::generate_context!())
        .expect("error while running Task Dashboard");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_and_empty_settings_are_valid() {
        assert!(validate(&Settings::default()).is_ok());
        assert!(validate(&Settings {
            version: 1,
            buttons: vec![]
        })
        .is_ok());
    }
    #[test]
    fn unsafe_urls_and_invalid_buttons_are_rejected() {
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "http://mail.google.com",
            "https://user:pass@example.com",
            "not a url",
        ] {
            let mut settings = Settings::default();
            settings.buttons[0].action = Action::Webmail {
                browser: Browser::Default,
                url: url.into(),
            };
            assert!(validate(&settings).is_err(), "{url}");
        }
        let mut settings = Settings::default();
        settings.buttons[1].id = settings.buttons[0].id.clone();
        assert!(validate(&settings).is_err());
        settings = Settings::default();
        settings.buttons[0].name = "  ".into();
        assert!(validate(&settings).is_err());
    }
    #[test]
    fn settings_roundtrip_preserves_browser_and_order() {
        let mut settings = Settings::default();
        settings.buttons.reverse();
        settings.buttons[0].action = Action::Webmail {
            browser: Browser::Firefox,
            url: "https://mail.google.com/".into(),
        };
        let restored: Settings =
            serde_json::from_slice(&serde_json::to_vec(&settings).unwrap()).unwrap();
        assert_eq!(restored.buttons[0].id, "hotmail");
        assert!(matches!(
            restored.buttons[0].action,
            Action::Webmail {
                browser: Browser::Firefox,
                ..
            }
        ));
        assert!(validate(&restored).is_ok());
    }
    fn assert_same_settings(actual: &Settings, expected: &Settings) {
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    fn customized_settings() -> Settings {
        let mut settings = Settings::default();
        for (index, button) in settings.buttons.iter_mut().enumerate() {
            button.name = format!("Custom inbox {index}");
            button.action = Action::Webmail {
                browser: [Browser::Chrome, Browser::Firefox, Browser::Edge][index].clone(),
                url: format!("https://mail{index}.example.com/inbox?folder=shared"),
            };
        }
        settings
    }
    #[test]
    fn editing_first_button_preserves_newer_settings_for_every_other_button() {
        let temp = tempfile::tempdir().unwrap();
        let (path, _) = settings_paths(temp.path());
        let stale = customized_settings();
        write_settings(&path, &stale).unwrap();
        let mut expected = stale.clone();
        expected.buttons[1].name = "Updated team inbox".into();
        expected.buttons[1].action = Action::Webmail {
            browser: Browser::Chrome,
            url: "https://team.example.com/new-inbox".into(),
        };
        change_settings_from(
            temp.path(),
            SettingsChange::Update {
                button: expected.buttons[1].clone(),
            },
        )
        .unwrap();
        // The first button's editor was opened before the other save.
        let mut edited = stale.buttons[0].clone();
        edited.name = "Updated work inbox".into();
        edited.action = Action::Webmail {
            browser: Browser::Edge,
            url: "https://work.example.com/new-inbox".into(),
        };
        expected.buttons[0] = edited.clone();
        let saved =
            change_settings_from(temp.path(), SettingsChange::Update { button: edited }).unwrap();
        assert_same_settings(&saved, &expected);
        assert_same_settings(&read_settings_from(temp.path()).unwrap(), &expected);
    }
    #[test]
    fn stale_editor_preserves_new_buttons_deletions_and_order() {
        let temp = tempfile::tempdir().unwrap();
        let (path, _) = settings_paths(temp.path());
        let stale = customized_settings();
        write_settings(&path, &stale).unwrap();
        let added = TaskButton {
            id: "new".into(),
            name: "New shared inbox".into(),
            action: Action::Webmail {
                browser: Browser::Firefox,
                url: "https://shared.example.com/".into(),
            },
        };
        change_settings_from(
            temp.path(),
            SettingsChange::Add {
                button: added.clone(),
            },
        )
        .unwrap();
        change_settings_from(temp.path(), SettingsChange::Delete { id: "gmail".into() }).unwrap();
        change_settings_from(
            temp.path(),
            SettingsChange::Move {
                id: "outlook".into(),
                direction: Direction::Down,
            },
        )
        .unwrap();
        let mut edited = stale.buttons[0].clone();
        edited.name = "Renamed work inbox".into();
        let saved = change_settings_from(
            temp.path(),
            SettingsChange::Update {
                button: edited.clone(),
            },
        )
        .unwrap();
        let expected = Settings {
            version: 1,
            buttons: vec![stale.buttons[2].clone(), edited, added],
        };
        assert_same_settings(&saved, &expected);
        assert_same_settings(&read_settings_from(temp.path()).unwrap(), &expected);
    }
    #[test]
    fn invalid_changes_leave_saved_settings_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let (path, _) = settings_paths(temp.path());
        let settings = customized_settings();
        write_settings(&path, &settings).unwrap();
        let original = fs::read(&path).unwrap();
        let mut invalid = settings.buttons[0].clone();
        invalid.action = Action::Webmail {
            browser: Browser::Default,
            url: "http://unsafe.example.com".into(),
        };
        let mut missing = settings.buttons[0].clone();
        missing.id = "deleted".into();
        for change in [
            SettingsChange::Update { button: invalid },
            SettingsChange::Update { button: missing },
            SettingsChange::Add {
                button: settings.buttons[0].clone(),
            },
            SettingsChange::Delete {
                id: "deleted".into(),
            },
            SettingsChange::Move {
                id: "deleted".into(),
                direction: Direction::Up,
            },
            SettingsChange::Move {
                id: "outlook".into(),
                direction: Direction::Up,
            },
            SettingsChange::Move {
                id: "hotmail".into(),
                direction: Direction::Down,
            },
        ] {
            assert!(change_settings_from(temp.path(), change).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }
    #[test]
    fn frontend_change_payloads_deserialize_and_apply() {
        let temp = tempfile::tempdir().unwrap();
        let (path, _) = settings_paths(temp.path());
        write_settings(&path, &customized_settings()).unwrap();
        for payload in [
            r#"{"type":"add","button":{"id":"new","name":"New inbox","action":{"type":"webmail","browser":"firefox","url":"https://example.com/mail"}}}"#,
            r#"{"type":"update","button":{"id":"new","name":"Updated inbox","action":{"type":"webmail","browser":"edge","url":"https://example.com/updated"}}}"#,
            r#"{"type":"move","id":"new","direction":"up"}"#,
            r#"{"type":"move","id":"new","direction":"down"}"#,
            r#"{"type":"delete","id":"new"}"#,
        ] {
            let change = serde_json::from_str(payload).unwrap();
            change_settings_from(temp.path(), change).unwrap();
        }
        assert_same_settings(
            &read_settings_from(temp.path()).unwrap(),
            &customized_settings(),
        );
    }
    #[test]
    fn settings_survive_removing_installation_and_bundle_data() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("user-config");
        let install = temp.path().join("install");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("app.exe"), b"old release").unwrap();
        let (path, legacy) = settings_paths(&root);
        let mut settings = Settings::default();
        settings.buttons.reverse();
        settings.buttons[0].name = "My custom email".into();
        settings.buttons[0].action = Action::Webmail {
            browser: Browser::Firefox,
            url: "https://example.com/inbox".into(),
        };
        write_settings(&path, &settings).unwrap();
        write_settings(&legacy, &Settings::default()).unwrap();
        // Simulate replacing the application and NSIS deleting bundle-ID app data.
        fs::remove_dir_all(&install).unwrap();
        fs::remove_dir_all(legacy.parent().unwrap()).unwrap();
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("app.exe"), b"new release").unwrap();
        assert_same_settings(&read_settings_from(&root).unwrap(), &settings);
    }
    #[test]
    fn migration_preserves_existing_settings_and_does_not_overwrite_newer_settings() {
        let temp = tempfile::tempdir().unwrap();
        let (path, legacy) = settings_paths(temp.path());
        let mut old = Settings::default();
        old.buttons.remove(1);
        old.buttons[0].name = "Existing work inbox".into();
        write_settings(&legacy, &old).unwrap();
        assert_same_settings(&read_settings_from(temp.path()).unwrap(), &old);
        assert!(legacy.exists());
        assert_same_settings(&read_file(&path).unwrap().unwrap(), &old);
        let newer = Settings {
            version: 1,
            buttons: vec![],
        };
        write_settings(&path, &newer).unwrap();
        assert_same_settings(&read_settings_from(temp.path()).unwrap(), &newer);
    }
    #[test]
    fn corrupt_or_future_settings_are_never_reset_or_replaced_by_legacy_data() {
        let temp = tempfile::tempdir().unwrap();
        let (path, legacy) = settings_paths(temp.path());
        write_settings(&legacy, &Settings::default()).unwrap();
        fs::write(&legacy, b"broken json").unwrap();
        assert!(read_settings_from(temp.path()).is_err());
        assert!(!path.exists());
        write_settings(&legacy, &Settings::default()).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        for bytes in [
            b"broken json".as_slice(),
            br#"{"version":2,"buttons":[]}"#.as_slice(),
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(read_settings_from(temp.path()).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
}
