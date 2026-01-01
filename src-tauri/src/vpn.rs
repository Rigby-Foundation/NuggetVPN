use serde_json::json;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::models::AppState;
use crate::parser::{parse_outbound, strip_ansi_codes};
use crate::storage::get_log_path;

pub fn get_singbox_path() -> String {
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
pub fn start_vpn(
    app: AppHandle,
    window: Window,
    state: State<AppState>,
) -> Result<String, String> {
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

    let local_dns_address = if cfg!(target_os = "windows") {
        format!("udp://{}", settings.dns)
    } else {
        "local".to_string()
    };

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
                {
                    "tag": "local",
                    "address": local_dns_address,
                    "detour": "direct"
                },
                { "tag": "remote", "address": format!("https://{}/dns-query", settings.dns), "address_resolver": "local", "detour": "proxy" }
            ],
            "rules": [
                { "outbound": "any", "action": "route", "server": "local" }
            ],
            "final": "remote",
            "strategy": "prefer_ipv4"
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
            "mtu": settings.mtu,
            "auto_route": true,
            "strict_route": true,
            "stack": "mixed",
            "sniff": true,
            "sniff_override_destination": true
        }],
        "outbounds": [
            outbound_config,
            { "type": "direct", "tag": "direct" },
            { "type": "block", "tag": "block" }
        ],
        "route": {
            "auto_detect_interface": true,
            "final": "proxy",
            "rules": [
                { "protocol": "dns", "action": "hijack-dns" },
                { "ip_cidr": [format!("{}/32", settings.dns)], "outbound": "direct" },
                { "ip_is_private": true, "outbound": "direct" }
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
        let cmd_args = format!(
            "/c \"\"{}\" run -c \"{}\" >> \"{}\" 2>&1\"",
            singbox_path, config_path_str, log_path_shell
        );

        Command::new("powershell")
            .arg("Start-Process")
            .arg("cmd")
            .arg("-ArgumentList")
            .arg(format!("'{}'", cmd_args))
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
pub fn stop_vpn(state: State<AppState>) -> Result<String, String> {
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
            .arg("-Command")
            .arg("Start-Process -FilePath 'taskkill' -ArgumentList '/F','/IM','sing-box.exe' -Verb RunAs -WindowStyle Hidden")
            .spawn();
    }

    *running = false;
    Ok("VPN Stopped".to_string())
}
