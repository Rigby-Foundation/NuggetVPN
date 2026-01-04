use reqwest::blocking::Client;
use reqwest::Proxy;
use serde::Serialize;
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::thread;
use tempfile::TempDir;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::models::{AppSettings, AppState, Profile};
use crate::parser::{detect_protocol, parse_outbound};
use crate::storage::{get_log_path, save_profiles_to_disk, save_settings_to_disk};
use crate::vpn::get_singbox_path;

const PING_TIMEOUT_MS: u64 = 2000;
const PING_BOOT_TIMEOUT_MS: u64 = 1500;
const PING_URL: &str = "https://www.google.com/generate_204";
const PING_WORKER_LIMIT: usize = 12;

#[derive(Serialize)]
pub struct ProfilePing {
    pub id: String,
    pub ping_ms: Option<u64>,
}

fn reserve_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok().map(|addr| addr.port()))
}

fn normalize_source_domain(profile: &Profile) -> String {
    let domain = profile.source_domain.trim();
    if domain.is_empty() {
        "local".to_string()
    } else {
        domain.to_string()
    }
}

fn wait_for_ports_ready(ports: &[u16], timeout: Duration) {
    if ports.is_empty() {
        return;
    }

    let start = Instant::now();
    let mut pending: Vec<u16> = ports.to_vec();
    let connect_timeout = Duration::from_millis(120);

    while !pending.is_empty() && start.elapsed() < timeout {
        pending.retain(|port| {
            let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), *port);
            TcpStream::connect_timeout(&addr, connect_timeout).is_err()
        });
        if !pending.is_empty() {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

fn measure_proxy_ping(port: u16, timeout: Duration) -> Option<u64> {
    let proxy_url = format!("socks5h://127.0.0.1:{}", port);
    let client = Client::builder()
        .proxy(Proxy::all(&proxy_url).ok()?)
        .timeout(timeout)
        .build()
        .ok()?;

    let start = Instant::now();
    let response = client.get(PING_URL).send();
    match response {
        Ok(_) => Some(start.elapsed().as_millis() as u64),
        Err(_) => None,
    }
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

    profiles.push(Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name,
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

    let mut inbounds = Vec::new();
    let mut outbounds = Vec::new();
    let mut route_rules = Vec::new();
    let mut port_map = Vec::new();
    let mut results = Vec::new();

    for (index, profile) in target_profiles.iter().enumerate() {
        let port = match reserve_port() {
            Some(p) => p,
            None => {
                results.push(ProfilePing {
                    id: profile.id.clone(),
                    ping_ms: None,
                });
                continue;
            }
        };

        let mut outbound = match parse_outbound(&profile.config_link, &settings) {
            Ok(outbound) => outbound,
            Err(_) => {
                results.push(ProfilePing {
                    id: profile.id.clone(),
                    ping_ms: None,
                });
                continue;
            }
        };

        let inbound_tag = format!("in-{}", index + 1);
        let outbound_tag = format!("proxy-{}", index + 1);
        outbound["tag"] = json!(outbound_tag.clone());
        outbounds.push(outbound);

        inbounds.push(json!({
            "type": "socks",
            "tag": inbound_tag.clone(),
            "listen": "127.0.0.1",
            "listen_port": port
        }));

        route_rules.push(json!({
            "type": "field",
            "inbound": [inbound_tag],
            "outbound": outbound_tag
        }));

        port_map.push((profile.id.clone(), port));
    }

    if port_map.is_empty() {
        return Ok(results);
    }

    outbounds.push(json!({ "type": "direct", "tag": "direct" }));

    let config = json!({
        "log": { "level": "error", "timestamp": false },
        "dns": {
            "servers": [{ "tag": "local", "address": "local" }],
            "strategy": "prefer_ipv4"
        },
        "inbounds": inbounds,
        "outbounds": outbounds,
        "route": {
            "rules": route_rules,
            "final": "direct"
        }
    });

    let dir = TempDir::new().map_err(|e| e.to_string())?;
    let config_path = dir.path().join("ping-config.json");
    let mut file = File::create(&config_path).map_err(|e| e.to_string())?;
    file.write_all(config.to_string().as_bytes())
        .map_err(|e| e.to_string())?;

    let mut child = Command::new(get_singbox_path())
        .arg("run")
        .arg("-c")
        .arg(&config_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    let ports: Vec<u16> = port_map.iter().map(|(_, port)| *port).collect();
    wait_for_ports_ready(&ports, Duration::from_millis(PING_BOOT_TIMEOUT_MS));

    let workers = std::cmp::min(PING_WORKER_LIMIT, port_map.len());
    if workers <= 1 {
        for (profile_id, port) in port_map {
            let ping_ms = measure_proxy_ping(port, timeout);
            results.push(ProfilePing {
                id: profile_id,
                ping_ms,
            });
        }
    } else {
        let tasks = Arc::new(Mutex::new(port_map));
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

                let Some((profile_id, port)) = task else {
                    break;
                };

                let ping_ms = measure_proxy_ping(port, timeout);
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

    let _ = child.kill();
    let _ = child.wait();

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
