use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::models::{AppSettings, Profile};
use crate::parser::decode_profile_name;

pub fn get_data_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("profiles.json")
}

pub fn get_settings_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("settings.json")
}

pub fn get_log_path(app: &AppHandle) -> PathBuf {
    let path = app.path().app_log_dir().unwrap().join("session.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    path
}

pub fn load_profiles_from_disk(app: &AppHandle) -> Vec<Profile> {
    let path = get_data_path(app);
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        let mut profiles: Vec<Profile> = serde_json::from_str(&data).unwrap_or_else(|_| vec![]);
        let mut changed = false;
        for profile in profiles.iter_mut() {
            let decoded_name = decode_profile_name(&profile.name);
            if decoded_name != profile.name {
                profile.name = decoded_name;
                changed = true;
            }
        }
        if changed {
            if let Ok(serialized) = serde_json::to_string_pretty(&profiles) {
                let _ = fs::write(&path, serialized);
            }
        }
        profiles
    } else {
        vec![]
    }
}

pub fn save_profiles_to_disk(app: &AppHandle, profiles: &Vec<Profile>) {
    let path = get_data_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(profiles).unwrap();
    let _ = fs::write(path, data);
}

pub fn load_settings_from_disk(app: &AppHandle) -> AppSettings {
    let path = get_settings_path(app);
    if path.exists() {
        let data = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

pub fn save_settings_to_disk(app: &AppHandle, settings: &AppSettings) {
    let path = get_settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(settings).unwrap();
    let _ = fs::write(path, data);
}
