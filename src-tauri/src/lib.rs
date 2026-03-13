mod auth;
mod commands;
mod models;
mod parser;
mod storage;
mod vpn;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
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
                vpn_stop_signal: Arc::new(AtomicBool::new(false)),
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

pub fn run_core() {
    let mut config = String::new();
    let mut cwd = String::new();
    let mut log_file = String::new();

    let args: Vec<String> = std::env::args().collect();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--config" && i + 1 < args.len() {
            config = args[i + 1].clone();
            i += 1;
        } else if args[i] == "--cwd" && i + 1 < args.len() {
            cwd = args[i + 1].clone();
            i += 1;
        } else if args[i] == "--log" && i + 1 < args.len() {
            log_file = args[i + 1].clone();
            i += 1;
        }
        i += 1;
    }

    if config.is_empty() {
        eprintln!("Missing --config");
        return;
    }

    let config_yaml = std::fs::read_to_string(&config).unwrap_or_default();

    let pid = std::process::id();
    let pid_file = std::path::Path::new(&cwd).join("core.pid");
    std::fs::write(&pid_file, pid.to_string()).unwrap_or_default();

    let stop_file = std::path::Path::new(&cwd).join("core.stop");
    let _ = std::fs::remove_file(&stop_file); // Remove if exists from previous run

    let stop_file_clone = stop_file.clone();
    std::thread::spawn(move || {
        loop {
            if stop_file_clone.exists() {
                clash_lib::shutdown();
                let _ = std::fs::remove_file(&stop_file_clone);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });

    let _ = clash_lib::start_scaffold(clash_lib::Options {
        config: clash_lib::Config::Str(config_yaml),
        cwd: if cwd.is_empty() { None } else { Some(cwd.clone()) },
        rt: Some(clash_lib::TokioRuntime::MultiThread),
        log_file: if log_file.is_empty() { None } else { Some(log_file) },
    });

    let _ = std::fs::remove_file(&pid_file);
}
