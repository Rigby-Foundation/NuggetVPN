use serde::Serialize;
use std::collections::HashSet;
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
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

fn resolve_ping_target(host: &str) -> Option<String> {
    let target = host.trim();
    if target.is_empty() {
        return None;
    }

    if let Ok(ip) = target.parse::<IpAddr>() {
        return Some(ip.to_string());
    }

    let addrs = (target, 0).to_socket_addrs().ok()?;
    let mut fallback_ip: Option<String> = None;
    for addr in addrs {
        let ip = addr.ip();
        if ip.is_ipv4() {
            return Some(ip.to_string());
        }
        if fallback_ip.is_none() {
            fallback_ip = Some(ip.to_string());
        }
    }
    fallback_ip
}

fn measure_proxy_ping(host: &str, timeout_ms: u64) -> Option<u64> {
    let target = resolve_ping_target(host)?;

    let mut command = Command::new("ping");
    #[cfg(target_os = "windows")]
    {
        command
            .arg("-n")
            .arg("1")
            .arg("-w")
            .arg(timeout_ms.to_string())
            .arg(&target);
    }
    #[cfg(target_os = "macos")]
    {
        command
            .arg("-c")
            .arg("1")
            .arg("-W")
            .arg(timeout_ms.to_string())
            .arg(&target);
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let timeout_seconds = std::cmp::max(1, (timeout_ms / 1000) as u64);
        command
            .arg("-c")
            .arg("1")
            .arg("-W")
            .arg(timeout_seconds.to_string())
            .arg(&target);
    }

    let start = Instant::now();
    match command.status() {
        Ok(status) if status.success() => Some(start.elapsed().as_millis() as u64),
        _ => None,
    }
}

fn measure_proxy_tcp(host: &str, port: u16, timeout: Duration) -> Option<u64> {
    let start = Instant::now();
    let addrs = (host, port).to_socket_addrs().ok()?;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return Some(start.elapsed().as_millis() as u64);
        }
    }
    None
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
        subscription_url: String::new(),
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

        if let Some(server) = server {
            if !server.trim().is_empty() {
                targets.push((profile.id.clone(), server));
                continue;
            }
        }
        {
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
        for (profile_id, server) in targets {
            let ping_ms = measure_proxy_ping(&server, PING_TIMEOUT_MS);
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

                let Some((profile_id, server)) = task else {
                    break;
                };

                let ping_ms = measure_proxy_ping(&server, PING_TIMEOUT_MS);
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
pub fn probe_profiles_connectivity(
    state: State<AppState>,
    source_domain: Option<String>,
    profile_ids: Option<Vec<String>>,
    timeout_ms: Option<u64>,
) -> Result<Vec<ProfilePing>, String> {
    let profiles = state.profiles.lock().unwrap().clone();
    let settings = state.settings.lock().unwrap().clone();
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(1200).clamp(200, 10_000));

    let mut target_domain = source_domain.unwrap_or_default();
    target_domain = target_domain.trim().to_string();
    if target_domain.is_empty() {
        target_domain = "local".to_string();
    }

    let mut target_profiles: Vec<Profile> = profiles
        .into_iter()
        .filter(|profile| normalize_source_domain(profile) == target_domain)
        .collect();

    if let Some(ids) = profile_ids {
        if !ids.is_empty() {
            let id_set: HashSet<String> = ids.into_iter().collect();
            target_profiles.retain(|profile| id_set.contains(&profile.id));
        }
    }

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
            let ping_ms = measure_proxy_tcp(&server, port, timeout);
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

                let ping_ms = measure_proxy_tcp(&server, port, timeout);
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
