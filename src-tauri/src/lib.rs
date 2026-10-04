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
#[tauri::command]
fn load_settings(
    app: tauri::AppHandle,
    lock: tauri::State<SettingsLock>,
) -> Result<Settings, String> {
    let _guard = lock.0.lock().map_err(|_| "Settings are unavailable.")?;
    read_settings(&app)
}
#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    lock: tauri::State<SettingsLock>,
    settings: Settings,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|_| "Settings are unavailable.")?;
    let (path, _) = settings_paths(&config_root(&app)?);
    write_settings(&path, &settings)
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
            save_settings,
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
