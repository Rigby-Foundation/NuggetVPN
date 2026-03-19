use serde::Serialize;
use std::collections::HashSet;
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::models::{AppSettings, AppState, Profile};
use crate::parser::{detect_protocol, extract_name_from_link, parse_outbound};
use crate::storage::{get_log_path, save_profiles_to_disk, save_settings_to_disk};

const PING_TIMEOUT_MS: u64 = 2000;
const PING_WORKER_LIMIT: usize = 12;

#[derive(Serialize)]
pub struct ProfilePing {
    pub id: String,
    pub ping_ms: Option<u64>,
}

fn normalize_source_domain(profile: &Profile) -> String {
    let domain = profile.source_domain.trim();
    if domain.is_empty() {
        "local".to_string()
    } else {
        domain.to_string()
    }
}

fn measure_proxy_ping(host: &str, port: u16, timeout: Duration) -> Option<u64> {
    let start = Instant::now();
    let addrs = (host, port).to_socket_addrs().ok()?;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return Some(start.elapsed().as_millis() as u64);
        }
    }
    None
}

fn parse_ip_from_body(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if let Ok(ip) = trimmed.parse::<IpAddr>() {
        return Some(ip.to_string());
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(ip) = json.get("ip").and_then(|value| value.as_str()) {
            if let Ok(parsed) = ip.trim().parse::<IpAddr>() {
                return Some(parsed.to_string());
            }
        }
    }

    for token in trimmed.split(|c: char| !(c.is_ascii_hexdigit() || c == '.' || c == ':')) {
        if token.is_empty() {
            continue;
        }
        if let Ok(ip) = token.parse::<IpAddr>() {
            return Some(ip.to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn probe_vpn_egress(timeout_ms: Option<u64>) -> Result<String, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(9000).clamp(1000, 20000));
    let proxy = reqwest::Proxy::all("http://127.0.0.1:7890")
        .map_err(|e| format!("Failed to configure local proxy: {}", e))?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .proxy(proxy)
        .build()
        .map_err(|e| format!("Failed to create probe client: {}", e))?;

    let endpoints = [
        "https://api.ipify.org?format=json",
        "https://ipinfo.io/ip",
        "https://ifconfig.me/ip",
    ];

    let mut errors = Vec::new();
    for endpoint in endpoints {
        match client.get(endpoint).send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    errors.push(format!("{} -> HTTP {}", endpoint, response.status()));
                    continue;
                }
                match response.text().await {
                    Ok(body) => {
                        if let Some(ip) = parse_ip_from_body(&body) {
                            return Ok(ip);
                        }
                        errors.push(format!("{} -> invalid IP payload", endpoint));
                    }
                    Err(e) => {
                        errors.push(format!("{} -> body error: {}", endpoint, e));
                    }
                }
            }
            Err(e) => {
                errors.push(format!("{} -> {}", endpoint, e));
            }
        }
    }

    Err(format!("VPN egress probe failed: {}", errors.join("; ")))
}

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
    let resolved_name = if name.trim().is_empty() {
        extract_name_from_link(&link)
    } else {
        name
    };

    profiles.push(Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name: resolved_name,
        server: "Auto".to_string(),
        protocol: protocol.to_string(),
        config_link: link,
        source_domain: "local".to_string(),
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
pub fn delete_profiles_by_source(
    app: AppHandle,
    state: State<AppState>,
    source_domain: String,
) -> Result<Vec<Profile>, String> {
    let mut profiles = state.profiles.lock().unwrap();
    let target = source_domain.trim();
    profiles.retain(|profile| normalize_source_domain(profile) != target);
    save_profiles_to_disk(&app, &profiles);
    Ok(profiles.clone())
}

#[tauri::command]
pub fn delete_profiles_by_ids(
    app: AppHandle,
    state: State<AppState>,
    ids: Vec<String>,
) -> Result<Vec<Profile>, String> {
    let mut profiles = state.profiles.lock().unwrap();
    if ids.is_empty() {
        return Ok(profiles.clone());
    }
    let id_set: HashSet<String> = ids.into_iter().collect();
    profiles.retain(|profile| !id_set.contains(&profile.id));
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
pub fn ping_profiles(
    state: State<AppState>,
    source_domain: Option<String>,
) -> Result<Vec<ProfilePing>, String> {
    let profiles = state.profiles.lock().unwrap().clone();
    let settings = state.settings.lock().unwrap().clone();
    let timeout = Duration::from_millis(PING_TIMEOUT_MS);

    let mut target_domain = source_domain.unwrap_or_default();
    target_domain = target_domain.trim().to_string();
    if target_domain.is_empty() {
        target_domain = "local".to_string();
    }

    let target_profiles: Vec<Profile> = profiles
        .into_iter()
        .filter(|profile| normalize_source_domain(profile) == target_domain)
        .collect();

    if target_profiles.is_empty() {
        return Ok(vec![]);
    }

    let mut targets = Vec::new();
    let mut results = Vec::new();

    for profile in target_profiles.iter() {
        let outbound = match parse_outbound(&profile.config_link, &settings) {
            Ok(outbound) => outbound,
            Err(_) => {
                results.push(ProfilePing {
                    id: profile.id.clone(),
                    ping_ms: None,
                });
                continue;
            }
        };

        let server = outbound
            .get(&serde_yaml::Value::String("server".to_string()))
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let port = outbound
            .get(&serde_yaml::Value::String("port".to_string()))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok());

        if let (Some(server), Some(port)) = (server, port) {
            if server.trim().is_empty() {
                results.push(ProfilePing {
                    id: profile.id.clone(),
                    ping_ms: None,
                });
                continue;
            }
            targets.push((profile.id.clone(), server, port));
        } else {
            results.push(ProfilePing {
                id: profile.id.clone(),
                ping_ms: None,
            });
        }
    }

    if targets.is_empty() {
        return Ok(results);
    }

    let workers = std::cmp::min(PING_WORKER_LIMIT, targets.len());
    if workers <= 1 {
        for (profile_id, server, port) in targets {
            let ping_ms = measure_proxy_ping(&server, port, timeout);
            results.push(ProfilePing {
                id: profile_id,
                ping_ms,
            });
        }
    } else {
        let tasks = Arc::new(Mutex::new(targets));
        let collected = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::with_capacity(workers);

        for _ in 0..workers {
            let tasks = Arc::clone(&tasks);
            let collected = Arc::clone(&collected);
            handles.push(thread::spawn(move || loop {
                let task = {
                    let mut locked = match tasks.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    locked.pop()
                };

                let Some((profile_id, server, port)) = task else {
                    break;
                };

                let ping_ms = measure_proxy_ping(&server, port, timeout);
                if let Ok(mut locked) = collected.lock() {
                    locked.push(ProfilePing {
                        id: profile_id,
                        ping_ms,
                    });
                }
            }));
        }

        for handle in handles {
            let _ = handle.join();
        }

        if let Ok(mut locked) = collected.lock() {
            results.extend(locked.drain(..));
        };
    }

    Ok(results)
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
