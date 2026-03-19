mod auth;
mod commands;
mod models;
mod parser;
mod storage;
mod vpn;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use models::AppState;
use storage::{load_profiles_from_disk, load_settings_from_disk};

const TRAY_SHOW_ID: &str = "tray_show";
const TRAY_QUIT_ID: &str = "tray_quit";

#[derive(Default)]
struct ExitState {
    quitting: AtomicBool,
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn shutdown_vpn_on_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.vpn_stop_signal.store(true, Ordering::SeqCst);
    if let Ok(mut running) = state.is_running.lock() {
        *running = false;
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            let stop_file = cache_dir.join("core.stop");
            let _ = std::fs::write(stop_file, "stop");
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        clash_lib::shutdown();
    }
}

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
            app.manage(ExitState::default());
            app.manage(AppState {
                profiles: Mutex::new(loaded),
                settings: Mutex::new(loaded_settings),
                is_running: Mutex::new(false),
                vpn_stop_signal: Arc::new(AtomicBool::new(false)),
            });

            let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "Open NuggetVPN", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Exit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("NuggetVPN")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    TRAY_SHOW_ID => reveal_main_window(app),
                    TRAY_QUIT_ID => {
                        app.state::<ExitState>().quitting.store(true, Ordering::SeqCst);
                        shutdown_vpn_on_exit(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _ = tray_builder.build(app)?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<ExitState>()
                    .quitting
                    .load(Ordering::SeqCst)
                {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_profiles,
            commands::add_profile,
            commands::delete_profile,
            commands::delete_profiles_by_source,
            commands::delete_profiles_by_ids,
            commands::open_logs_folder,
            commands::ping_profiles,
            commands::probe_vpn_egress,
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
