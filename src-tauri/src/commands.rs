use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::models::{AppSettings, AppState, Profile};
use crate::parser::detect_protocol;
use crate::storage::{get_log_path, save_profiles_to_disk, save_settings_to_disk};

#[tauri::command]
pub fn get_profiles(state: State<AppState>) -> Vec<Profile> {
    state.profiles.lock().unwrap().clone()
}

#[tauri::command]
pub fn add_profile(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    link: String,
) -> Result<Vec<Profile>, String> {
    let mut profiles = state.profiles.lock().unwrap();
    let protocol = detect_protocol(&link);

    profiles.push(Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        server: "Auto".to_string(),
        protocol: protocol.to_string(),
        config_link: link,
        total_up: Some(0),
        total_down: Some(0),
    });
    save_profiles_to_disk(&app, &profiles);
    Ok(profiles.clone())
}

#[tauri::command]
pub fn delete_profile(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<Vec<Profile>, String> {
    let mut profiles = state.profiles.lock().unwrap();
    profiles.retain(|p| p.id != id);
    save_profiles_to_disk(&app, &profiles);
    Ok(profiles.clone())
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) {
    let log_path = get_log_path(&app);
    if let Some(parent) = log_path.parent() {
        let _ = app
            .opener()
            .open_path(parent.to_str().unwrap(), None::<&str>);
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let mut s = state.settings.lock().unwrap();
    *s = settings;
    save_settings_to_disk(&app, &s);
    Ok(())
}

#[tauri::command]
pub fn update_profile_usage(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    up: u64,
    down: u64,
) -> Result<(), String> {
    let mut profiles = state.profiles.lock().unwrap();
    if let Some(profile) = profiles.iter_mut().find(|p| p.id == id) {
        profile.total_up = Some(profile.total_up.unwrap_or(0) + up);
        profile.total_down = Some(profile.total_down.unwrap_or(0) + down);
        save_profiles_to_disk(&app, &profiles);
    }
    Ok(())
}
