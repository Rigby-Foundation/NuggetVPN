mod auth;
mod commands;
mod models;
mod parser;
mod storage;
mod vpn;

use std::sync::Mutex;
use tauri::Manager;
use models::AppState;
use storage::{load_profiles_from_disk, load_settings_from_disk};

#[tauri::command]
fn get_current_platform() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let loaded = load_profiles_from_disk(app.handle());
            let loaded_settings = load_settings_from_disk(app.handle());
            app.manage(AppState {
                profiles: Mutex::new(loaded),
                settings: Mutex::new(loaded_settings),
                is_running: Mutex::new(false),
            });
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_profiles,
            commands::add_profile,
            commands::delete_profile,
            commands::delete_profiles_by_source,
            commands::delete_profiles_by_ids,
            commands::open_logs_folder,
            commands::ping_profiles,
            commands::get_settings,
            commands::save_settings,
            commands::update_profile_usage,
            auth::import_subscription,
            auth::login_user,
            auth::register_user,
            auth::push_profiles_to_server,
            auth::pull_profiles_from_server,
            vpn::start_vpn,
            vpn::stop_vpn,
            get_current_platform,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
