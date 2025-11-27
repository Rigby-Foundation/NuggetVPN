use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_opener::OpenerExt;
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Profile {
    id: String,
    name: String,
    server: String,
    protocol: String,
    config_link: String,
    total_up: Option<u64>,
    total_down: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppSettings {
    mtu: u32,
    dns: String,
    tls_fragment: bool,
    tls_fragment_size: String,
    tls_fragment_sleep: String,
    tls_mixed_sni_case: bool,
    tls_padding: bool,
    #[serde(default)]
    pub auth_server: Option<String>,
    #[serde(default)]
    pub auth_token: Option<String>,
    #[serde(default)]
    pub skip_auth: bool,
    #[serde(default)]
    pub pending_sync_upload: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            mtu: 9000,
            dns: "1.1.1.1".to_string(),
            tls_fragment: false,
            tls_fragment_size: "100-200".to_string(),
            tls_fragment_sleep: "10-20".to_string(),
            tls_mixed_sni_case: false,
            tls_padding: false,
            auth_server: None,
            auth_token: None,
            skip_auth: false,
            pending_sync_upload: false,
        }
    }
}

struct AppState {
    profiles: Mutex<Vec<Profile>>,
    settings: Mutex<AppSettings>,
    is_running: Mutex<bool>,
}

fn get_data_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("profiles.json")
}

fn get_settings_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("settings.json")
}

fn get_log_path(app: &AppHandle) -> PathBuf {
    let path = app.path().app_log_dir().unwrap().join("session.log");
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    path
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

fn load_settings_from_disk(app: &AppHandle) -> AppSettings {
    let path = get_settings_path(app);
    if path.exists() {
        let data = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

fn save_settings_to_disk(app: &AppHandle, settings: &AppSettings) {
    let path = get_settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(settings).unwrap();
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

fn parse_outbound(link: &str, settings: &AppSettings) -> Result<Value, String> {
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

                    if settings.tls_fragment {
                        outbound["tls"]["utls"]["tls_fragment"] = json!({
                            "enabled": true,
                            "size": settings.tls_fragment_size,
                            "sleep": settings.tls_fragment_sleep
                        });
                    }

                    if settings.tls_mixed_sni_case {
                        outbound["tls"]["mixed_sni_case"] = json!(true);
                    }

                    if settings.tls_padding {
                        outbound["tls"]["padding"] = json!(true);
                    }
                } else if security == "tls" {
                    outbound["tls"] = json!({
                        "enabled": true,
                        "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                        "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                        "insecure": true
                    });

                    if settings.tls_fragment {
                        outbound["tls"]["utls"]["tls_fragment"] = json!({
                            "enabled": true,
                            "size": settings.tls_fragment_size,
                            "sleep": settings.tls_fragment_sleep
                        });
                    }

                    if settings.tls_mixed_sni_case {
                        outbound["tls"]["mixed_sni_case"] = json!(true);
                    }

                    if settings.tls_padding {
                        outbound["tls"]["padding"] = json!(true);
                    }
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
        "hy2" | "hysteria2" => {
            let password = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let mut outbound = json!({
                "type": "hysteria2",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "password": password,
                "tls": {
                    "enabled": true,
                    "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                    "insecure": params.get("insecure").map(|v| v == "1").unwrap_or(false)
                }
            });

            if let Some(obfs) = params.get("obfs") {
                if obfs != "none" {
                    outbound["obfs"] = json!({
                        "type": "salamander",
                        "password": params.get("obfs-password").unwrap_or(&"".to_string())
                    });
                }
            }

            Ok(outbound)
        }
        "wireguard" => {
            let private_key = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            Ok(json!({
                "type": "wireguard",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "private_key": private_key,
                "peer_public_key": params.get("public_key").unwrap_or(&"".to_string()),
                "local_address": [params.get("ip").unwrap_or(&"10.0.0.2/32".to_string())],
                "mtu": params.get("mtu").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1280)
            }))
        }
        "socks" | "socks5" | "socks4" => {
            let username = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;

            let resolved_ip = resolve_host(domain);

            let version = if protocol == "socks4" { "4" } else { "5" };

            Ok(json!({
                "type": "socks",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "version": version,
                "username": username,
                "password": password
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
    } else if link.starts_with("hy2") || link.starts_with("hysteria2") {
        "hysteria2"
    } else if link.starts_with("wireguard") {
        "wireguard"
    } else if link.starts_with("socks") {
        "socks"
    } else {
        "unknown"
    };

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
fn get_settings(state: State<AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
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
fn update_profile_usage(
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
        } else if link.starts_with("hy2") || link.starts_with("hysteria2") {
            "hysteria2"
        } else if link.starts_with("wireguard") {
            "wireguard"
        } else if link.starts_with("socks") {
            "socks"
        } else {
            continue;
        };

        profiles.push(Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: extract_name_from_link(link),
            server: "Auto".to_string(),
            protocol: protocol.to_string(),
            config_link: link.to_string(),
            total_up: Some(0),
            total_down: Some(0),
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

#[derive(Serialize, Deserialize)]
struct AuthResponse {
    token: Option<String>,
    message: Option<String>,
}

#[tauri::command]
async fn login_user(server: String, username: String, password: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/login", server.trim_end_matches('/'));

    let res = client
        .post(&url)
        .json(&json!({
            "username": username,
            "password": password
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(text);
    }

    let data: AuthResponse = res.json().await.map_err(|e| e.to_string())?;

    match data.token {
        Some(token) => Ok(token),
        None => Err("No token received".to_string()),
    }
}

#[tauri::command]
async fn register_user(
    server: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/register", server.trim_end_matches('/'));

    let res = client
        .post(&url)
        .json(&json!({
            "username": username,
            "password": password
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(text);
    }

    Ok("Registration successful".to_string())
}

#[derive(Serialize, Deserialize)]
struct ServerProfile {
    id: String,
    name: String,
    hash: String,
    encryption_type: String,
    updated_at: String,
}

#[tauri::command]
async fn push_profiles_to_server(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<String, String> {
    let server = settings.auth_server.ok_or("No auth server configured")?;
    let token = settings.auth_token.ok_or("No auth token configured")?;

    let profiles = load_profiles_from_disk(&app);
    let client = reqwest::Client::new();
    let url = format!("{}/profiles", server.trim_end_matches('/'));

    for profile in profiles {
        // Serialize profile to JSON string to use as "hash"
        let profile_json = serde_json::to_string(&profile).map_err(|e| e.to_string())?;

        let res = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&json!({
                "name": profile.name,
                "hash": profile_json,
                "encryption_type": "json" // Using "json" as type for now since we are just storing the struct
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            // Log error but continue? Or fail?
            // For now, let's fail to ensure consistency
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Failed to push profile {}: {}", profile.name, text));
        }
    }

    Ok("All profiles pushed successfully".to_string())
}

#[tauri::command]
async fn pull_profiles_from_server(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<Vec<Profile>, String> {
    let server = settings.auth_server.ok_or("No auth server configured")?;
    let token = settings.auth_token.ok_or("No auth token configured")?;

    let client = reqwest::Client::new();
    let url = format!("{}/profiles", server.trim_end_matches('/'));

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(text);
    }

    let server_profiles: Vec<ServerProfile> = res.json().await.map_err(|e| e.to_string())?;
    let mut local_profiles: Vec<Profile> = Vec::new();

    for sp in server_profiles {
        // Try to deserialize the "hash" back into a Profile
        // If it fails (e.g. legacy format or actual encryption), we might need to handle it
        // For now, assuming it's the JSON we pushed
        match serde_json::from_str::<Profile>(&sp.hash) {
            Ok(mut p) => {
                // Ensure ID matches or generate new?
                // The server profile has its own ID, but the embedded profile has one too.
                // Let's trust the embedded one for now, or maybe update it?
                // Actually, if we are syncing, we should probably keep the ID consistent.
                local_profiles.push(p);
            }
            Err(e) => {
                println!("Failed to parse profile {}: {}", sp.name, e);
            }
        }
    }

    if !local_profiles.is_empty() {
        save_profiles_to_disk(&app, &local_profiles);
    }

    Ok(local_profiles)
}

fn get_singbox_path() -> String {
    let current_exe = std::env::current_exe().unwrap();
    let exe_dir = current_exe.parent().unwrap();

    #[cfg(target_os = "macos")]
    {
        let target = if cfg!(target_arch = "x86_64") {
            "x86_64-apple-darwin"
        } else {
            "aarch64-apple-darwin"
        };

        let path = exe_dir.join(format!("sing-box-{}", target));
        if path.exists() {
            return path.to_str().unwrap().to_string();
        }

        let simple_path = exe_dir.join("sing-box");
        if simple_path.exists() {
            return simple_path.to_str().unwrap().to_string();
        }

        let resources_path = exe_dir
            .parent()
            .unwrap()
            .join("Resources")
            .join("bin")
            .join(format!("sing-box-{}", target));
        if resources_path.exists() {
            return resources_path.to_str().unwrap().to_string();
        }

        let resources_simple_path = exe_dir
            .parent()
            .unwrap()
            .join("Resources")
            .join("bin")
            .join("sing-box");
        if resources_simple_path.exists() {
            return resources_simple_path.to_str().unwrap().to_string();
        }

        let dev_path = exe_dir.join(format!("sing-box-{}", target));
        return dev_path.to_str().unwrap().to_string();
    }

    #[cfg(target_os = "linux")]
    {
        let target = "x86_64-unknown-linux-gnu";
        let path = exe_dir.join(format!("sing-box-{}", target));
        if path.exists() {
            return path.to_str().unwrap().to_string();
        }

        let simple_path = exe_dir.join("sing-box");
        if simple_path.exists() {
            return simple_path.to_str().unwrap().to_string();
        }

        return path.to_str().unwrap().to_string();
    }

    #[cfg(target_os = "windows")]
    {
        let target = "x86_64-pc-windows-msvc";
        let path = exe_dir.join(format!("sing-box-{}.exe", target));
        if path.exists() {
            return path.to_str().unwrap().to_string();
        }

        let simple_path = exe_dir.join("sing-box.exe");
        if simple_path.exists() {
            return simple_path.to_str().unwrap().to_string();
        }

        return path.to_str().unwrap().to_string();
    }
}

#[tauri::command]
fn start_vpn(app: AppHandle, window: Window, state: State<AppState>) -> Result<String, String> {
    let mut running = state.is_running.lock().unwrap();
    if *running {
        return Err("Already running".to_string());
    }

    let profiles = state.profiles.lock().unwrap();
    let current_profile = profiles.first().ok_or("No profiles found")?;
    let settings = state.settings.lock().unwrap();

    let outbound_config = parse_outbound(&current_profile.config_link, &settings)?;

    let log_path = get_log_path(&app);

    let _ = File::create(&log_path);

    let final_config = json!({
        "log": {
            "level": "info",
            "timestamp": true
        },
        "experimental": {
            "clash_api": {
                "external_controller": "127.0.0.1:9090"
            }
        },
        "dns": {
            "servers": [
                { "tag": "custom", "address": settings.dns, "detour": "proxy" },
                { "tag": "local", "address": "local", "detour": "direct" }
            ],
            "rules": [
                { "outbound": "any", "server": "custom" }
            ]
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "address": ["172.19.0.1/30"],
            "mtu": settings.mtu,
            "auto_route": true,
            "strict_route": true,
            "stack": "gvisor",
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

    let singbox_path = get_singbox_path();
    let config_path_str = config_path.to_str().unwrap();
    let log_path_shell = log_path.to_str().unwrap();

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"\\\"{}\\\" run -c \\\"{}\\\" >> \\\"{}\\\" 2>&1 &\" with administrator privileges",
            singbox_path, config_path_str, log_path_shell
        );

        Command::new("osascript")
            .arg("-e")
            .arg(script)
            .spawn()
            .map_err(|e| format!("Failed to start VPN: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let cmd = format!(
            "\"{}\" run -c \"{}\" >> \"{}\" 2>&1",
            singbox_path, config_path_str, log_path_shell
        );
        Command::new("pkexec")
            .arg("sh")
            .arg("-c")
            .arg(cmd)
            .spawn()
            .map_err(|e| format!("Failed to start VPN: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // We need to wrap the command in cmd /c to support output redirection (>>)
        // And we run cmd via PowerShell Start-Process to get UAC (RunAs) and hide the window
        let cmd_args = format!(
            "/c \"\"{}\" run -c \"{}\" >> \"{}\" 2>&1\"",
            singbox_path, config_path_str, log_path_shell
        );

        Command::new("powershell")
            .arg("Start-Process")
            .arg("cmd")
            .arg("-ArgumentList")
            .arg(format!("'{}'", cmd_args)) // Single quote the whole argument string for PowerShell
            .arg("-Verb")
            .arg("RunAs")
            .arg("-WindowStyle")
            .arg("Hidden")
            .spawn()
            .map_err(|e| format!("Failed to start VPN: {}", e))?;
    }

    *running = true;

    let log_path_clone = log_path.clone();
    tauri::async_runtime::spawn(async move {
        let mut file = match File::open(&log_path_clone) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut pos = 0;

        loop {
            let mut contents = String::new();
            if let Ok(_) = file.seek(SeekFrom::Start(pos)) {
                if let Ok(_) = file.read_to_string(&mut contents) {
                    if !contents.is_empty() {
                        pos += contents.len() as u64;
                        let mut batch = Vec::new();
                        for line in contents.lines() {
                            batch.push(strip_ansi_codes(line));
                        }
                        if !batch.is_empty() {
                            let _ = window.emit("vpn-log", batch);
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });

    Ok("VPN Started".to_string())
}

#[tauri::command]
fn stop_vpn(state: State<AppState>) -> Result<String, String> {
    let mut running = state.is_running.lock().unwrap();

    #[cfg(target_os = "macos")]
    {
        let script = "do shell script \"pkill -f sing-box\" with administrator privileges";
        let _ = Command::new("osascript").arg("-e").arg(script).output();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("pkexec")
            .arg("pkill")
            .arg("-f")
            .arg("sing-box")
            .output();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("powershell")
            .arg("Start-Process")
            .arg("-FilePath")
            .arg("taskkill")
            .arg("-ArgumentList")
            .arg("/F /IM sing-box*")
            .arg("-Verb")
            .arg("RunAs")
            .arg("-WindowStyle")
            .arg("Hidden")
            .spawn();
    }

    *running = false;
    Ok("VPN Stopped".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
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
            get_profiles,
            add_profile,
            delete_profile,
            import_subscription,
            start_vpn,
            stop_vpn,
            open_logs_folder,
            get_settings,
            save_settings,
            update_profile_usage,
            login_user,
            register_user,
            push_profiles_to_server,
            pull_profiles_from_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
