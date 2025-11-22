use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Profile {
    id: String,
    name: String,
    server: String,
    protocol: String,
    config_link: String,
}

struct AppState {
    profiles: Mutex<Vec<Profile>>,
    child_process: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

fn get_data_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("profiles.json")
}

fn get_log_path(app: &AppHandle) -> PathBuf {
    let path = app.path().app_log_dir().unwrap().join("session.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    path
}

fn append_log_to_file(path: &PathBuf, msg: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let line = if msg.ends_with('\n') {
            msg.to_string()
        } else {
            format!("{}\n", msg)
        };
        let _ = file.write_all(line.as_bytes());
    }
}

fn load_profiles_from_disk(app: &AppHandle) -> Vec<Profile> {
    let path = get_data_path(app);
    if path.exists() {
        let data = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    }
}

fn save_profiles_to_disk(app: &AppHandle, profiles: &Vec<Profile>) {
    let path = get_data_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(profiles).unwrap();
    let _ = fs::write(path, data);
}

fn strip_ansi_codes(s: &str) -> String {
    let mut result = String::new();
    let mut in_escape = false;
    for c in s.chars() {
        if c == '\x1b' {
            in_escape = true;
        } else if in_escape {
            if c == 'm' {
                in_escape = false;
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn extract_name_from_link(link: &str) -> String {
    if let Ok(parsed) = Url::parse(link) {
        if let Some(fragment) = parsed.fragment() {
            return urlencoding::decode(fragment)
                .unwrap_or_default()
                .to_string();
        }
    }
    "Imported Profile".to_string()
}

fn resolve_host(host: &str) -> String {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return host.to_string();
    }

    match (host, 443).to_socket_addrs() {
        Ok(mut addrs) => {
            if let Some(addr) = addrs.find(|a| a.is_ipv4()) {
                return addr.ip().to_string();
            }
            host.to_string()
        }
        Err(_) => host.to_string(),
    }
}

fn parse_outbound(link: &str) -> Result<Value, String> {
    let url = Url::parse(link).map_err(|_| "Invalid URL format")?;
    let protocol = url.scheme();

    match protocol {
        "vless" => {
            let uuid = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let mut outbound = json!({
                "type": "vless",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "uuid": uuid,
                "flow": params.get("flow").unwrap_or(&"".to_string())
            });

            if let Some(security) = params.get("security") {
                if security == "reality" {
                    outbound["tls"] = json!({
                        "enabled": true,
                        "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                        "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                        "reality": {
                            "enabled": true,
                            "public_key": params.get("pbk").unwrap_or(&"".to_string()),
                            "short_id": params.get("sid").unwrap_or(&"".to_string())
                        }
                    });
                } else if security == "tls" {
                    outbound["tls"] = json!({
                        "enabled": true,
                        "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                        "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                        "insecure": true
                    });
                }
            }
            Ok(outbound)
        }
        "ss" => {
            let user_info = url.username();
            let decoded_user = general_purpose::URL_SAFE
                .decode(user_info)
                .map(|b| String::from_utf8(b).unwrap_or(user_info.to_string()))
                .unwrap_or(user_info.to_string());

            let parts: Vec<&str> = decoded_user.split(':').collect();
            if parts.len() < 2 {
                return Err("Invalid SS format".to_string());
            }

            let domain = url.host_str().unwrap();
            let resolved_ip = resolve_host(domain);

            Ok(json!({
                "type": "shadowsocks",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": url.port().unwrap(),
                "method": parts[0],
                "password": parts[1]
            }))
        }
        _ => Err(format!("Protocol {} not supported", protocol)),
    }
}

#[tauri::command]
fn get_profiles(state: State<AppState>) -> Vec<Profile> {
    state.profiles.lock().unwrap().clone()
}

#[tauri::command]
fn add_profile(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    link: String,
) -> Result<Vec<Profile>, String> {
    let mut profiles = state.profiles.lock().unwrap();
    let protocol = if link.starts_with("vless") {
        "vless"
    } else if link.starts_with("ss") {
        "ss"
    } else {
        "unknown"
    };

    profiles.push(Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        server: "Auto".to_string(),
        protocol: protocol.to_string(),
        config_link: link,
    });
    save_profiles_to_disk(&app, &profiles);
    Ok(profiles.clone())
}

#[tauri::command]
fn delete_profile(
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
fn open_logs_folder(app: AppHandle) {
    let log_path = get_log_path(&app);
    if let Some(parent) = log_path.parent() {
        let _ = app
            .opener()
            .open_path(parent.to_str().unwrap(), None::<&str>);
    }
}

#[tauri::command]
async fn import_subscription(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<Profile>, String> {
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let clean_text = text.trim().replace("\n", "").replace("\r", "");

    let decoded_bytes = general_purpose::STANDARD
        .decode(&clean_text)
        .or_else(|_| general_purpose::URL_SAFE.decode(&clean_text))
        .unwrap_or_else(|_| clean_text.as_bytes().to_vec());
    let decoded_string = String::from_utf8(decoded_bytes).map_err(|_| "Invalid UTF-8")?;

    let mut profiles = state.profiles.lock().unwrap();
    let mut added = false;

    for line in decoded_string.lines() {
        let link = line.trim();
        if link.is_empty() {
            continue;
        }
        let protocol = if link.starts_with("vless") {
            "vless"
        } else if link.starts_with("ss") {
            "ss"
        } else {
            continue;
        };

        profiles.push(Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: extract_name_from_link(link),
            server: "Auto".to_string(),
            protocol: protocol.to_string(),
            config_link: link.to_string(),
        });
        added = true;
    }

    if added {
        save_profiles_to_disk(&app, &profiles);
        Ok(profiles.clone())
    } else {
        Err("No profiles found".to_string())
    }
}

#[tauri::command]
fn start_vpn(app: AppHandle, window: Window, state: State<AppState>) -> Result<String, String> {
    let mut child_guard = state.child_process.lock().unwrap();
    if child_guard.is_some() {
        return Err("Already running".to_string());
    }

    let profiles = state.profiles.lock().unwrap();
    let current_profile = profiles.first().ok_or("No profiles found")?;

    let outbound_config = parse_outbound(&current_profile.config_link)?;

    let log_path = get_log_path(&app);
    let _ = File::create(&log_path);

    let final_config = json!({
        "log": { "level": "info", "timestamp": true },
        "dns": {
            "servers": [
                { "tag": "google", "address": "8.8.8.8", "detour": "proxy" },
                { "tag": "local", "address": "local", "detour": "direct" }
            ],
            "rules": [
                { "outbound": "any", "server": "google" }
            ]
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",

            "address": ["172.19.0.1/30"],
            "mtu": 1280,
            "auto_route": true,
            "strict_route": true,
            "stack": "system",
            "sniff": true
        }],
        "outbounds": [
            outbound_config,
            { "type": "direct", "tag": "direct" }

        ],
        "route": {
            "auto_detect_interface": true,
            "rules": [
                { "protocol": "dns", "action": "hijack-dns" },
                { "inbound": "tun-in", "outbound": "proxy" }
            ]
        }
    });

    let config_path = app.path().app_cache_dir().unwrap().join("config.json");
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut file = File::create(&config_path).map_err(|e| e.to_string())?;
    file.write_all(final_config.to_string().as_bytes())
        .map_err(|e| e.to_string())?;

    let sidecar_command = app.shell().sidecar("sing-box").map_err(|e| e.to_string())?;
    let (mut rx, child) = sidecar_command
        .args(["run", "-c", config_path.to_str().unwrap()])
        .spawn()
        .map_err(|e| format!("Failed to spawn sing-box: {}. Try Admin/Sudo!", e))?;

    *child_guard = Some(child);

    let log_path_clone = log_path.clone();
    tauri::async_runtime::spawn(async move {
        append_log_to_file(&log_path_clone, "--- VPN STARTING ---");
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let raw = String::from_utf8_lossy(&line).to_string();
                    let clean = strip_ansi_codes(&raw);
                    let _ = window.emit("vpn-log", clean.clone());
                    append_log_to_file(&log_path_clone, &clean);
                }
                _ => {}
            }
        }
        append_log_to_file(&log_path_clone, "--- VPN STOPPED ---");
    });

    Ok("VPN Started".to_string())
}

#[tauri::command]
fn stop_vpn(state: State<AppState>) -> Result<String, String> {
    let mut child_guard = state.child_process.lock().unwrap();
    if let Some(child) = child_guard.take() {
        let _ = child.kill();
        return Ok("VPN Stopped".to_string());
    }
    Err("Not running".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    {
        use nix::unistd::Uid;
        use std::process::Command;

        if !Uid::effective().is_root() {
            println!("Root privileges missing. Attempting to restart with elevation...");

            let current_exe = std::env::current_exe().expect("Failed to get current exe path");
            let exe_path_str = current_exe.to_str().expect("Invalid path string");

            let safe_path = exe_path_str.replace("\"", "\\\"");

            #[cfg(target_os = "macos")]
            let script = format!(
                "do shell script \"\\\"{}\\\"\" with administrator privileges",
                safe_path
            );

            #[cfg(target_os = "macos")]
            {
                match Command::new("osascript").arg("-e").arg(script).spawn() {
                    Ok(_) => {
                        std::process::exit(0);
                    }
                    Err(e) => {
                        eprintln!("Failed to request elevation: {}", e);

                        std::process::exit(1);
                    }
                }
            }

            #[cfg(target_os = "linux")]
            {
                eprintln!("На Linux необходимо запускать приложение через sudo!");
                std::process::exit(1);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let loaded = load_profiles_from_disk(app.handle());
            app.manage(AppState {
                profiles: Mutex::new(loaded),
                child_process: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_profiles,
            add_profile,
            delete_profile,
            import_subscription,
            start_vpn,
            stop_vpn,
            open_logs_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
