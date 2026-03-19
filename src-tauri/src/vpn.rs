use serde_yaml::Value as YValue;
use std::collections::{HashSet, VecDeque};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::models::AppState;
use crate::parser::{parse_clash_config, parse_outbound, ClashConfig};
use crate::storage::get_log_path;

fn ystr(s: &str) -> YValue {
    YValue::String(s.to_string())
}

fn expand_process_names(apps: &[String]) -> Vec<String> {
    let mut names = Vec::new();
    for entry in apps {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }

        let file_name = trimmed
            .rsplit(|c| c == '/' || c == '\\')
            .next()
            .unwrap_or(trimmed)
            .trim();
        if file_name.is_empty() {
            continue;
        }

        names.push(file_name.to_string());

        let mut base = file_name.strip_suffix(".app").unwrap_or(file_name);
        base = base.strip_suffix(".exe").unwrap_or(base);

        if base != file_name {
            names.push(base.to_string());
        }

        if !base.is_empty() {
            names.push(format!("{} Helper", base));
            names.push(format!("{} Helper (Renderer)", base));
            names.push(format!("{} Helper (GPU)", base));
            names.push(format!("{} Helper (Plugin)", base));
            names.push(format!("{} Helper (Zygote)", base));
        }
    }

    let mut seen = HashSet::new();
    let mut unique = Vec::new();
    for name in names {
        if seen.insert(name.clone()) {
            unique.push(name);
        }
    }
    unique
}

fn merge_process_names(mut names: Vec<String>, process_paths: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = names.iter().cloned().collect();
    for path in process_paths {
        let path_obj = Path::new(path);
        if let Some(file_name) = path_obj.file_name().and_then(|name| name.to_str()) {
            if seen.insert(file_name.to_string()) {
                names.push(file_name.to_string());
            }
        }
        if let Some(stem) = path_obj.file_stem().and_then(|name| name.to_str()) {
            if seen.insert(stem.to_string()) {
                names.push(stem.to_string());
            }
        }
    }
    names
}

fn push_process_path(paths: &mut Vec<String>, seen: &mut HashSet<String>, path: &Path) {
    if let Some(path_str) = path.to_str() {
        if seen.insert(path_str.to_string()) {
            paths.push(path_str.to_string());
        }
    }
}

fn collect_macos_execs(app_path: &Path, paths: &mut Vec<String>, seen: &mut HashSet<String>) {
    let macos_dir = app_path.join("Contents").join("MacOS");
    if let Ok(entries) = fs::read_dir(&macos_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                push_process_path(paths, seen, &path);
            }
        }
    }
}

fn collect_bundle_execs(bundle_path: &Path, paths: &mut Vec<String>, seen: &mut HashSet<String>) {
    collect_macos_execs(bundle_path, paths, seen);

    let frameworks_dir = bundle_path.join("Contents").join("Frameworks");
    let mut queue = VecDeque::new();
    queue.push_back(frameworks_dir);
    let mut visited = 0;
    let max_dirs = 2000;

    while let Some(dir) = queue.pop_front() {
        if visited >= max_dirs {
            break;
        }
        visited += 1;

        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.extension().and_then(|ext| ext.to_str()) == Some("app") {
                    collect_macos_execs(&path, paths, seen);
                } else {
                    queue.push_back(path);
                }
            }
        }
    }
}

fn extract_process_paths(apps: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for entry in apps {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        let is_path = trimmed.contains('/') || trimmed.contains('\\');
        if !is_path {
            continue;
        }

        if trimmed.ends_with(".app") {
            let bundle_path = Path::new(trimmed);
            push_process_path(&mut paths, &mut seen, bundle_path);
            let bundle_name = bundle_path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if !bundle_name.is_empty() {
                let exec_path = bundle_path
                    .join("Contents")
                    .join("MacOS")
                    .join(bundle_name);
                push_process_path(&mut paths, &mut seen, &exec_path);
            }
            collect_bundle_execs(bundle_path, &mut paths, &mut seen);
            continue;
        }

        push_process_path(&mut paths, &mut seen, Path::new(trimmed));
    }
    paths
}

#[tauri::command]
pub async fn start_vpn(
    app: AppHandle,
    _window: Window,
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<String, String> {
    {
        let running = state.is_running.lock().unwrap();
        if *running {
            return Err("Already running".to_string());
        }
    }

    let profiles = state.profiles.lock().unwrap().clone();
    let settings = state.settings.lock().unwrap().clone();

    let selected_id = profile_id.as_deref().filter(|id| !id.is_empty());
    let current_profile = selected_id
        .and_then(|id| profiles.iter().find(|p| p.id == id))
        .or_else(|| profiles.first())
        .ok_or("No profiles found")?
        .clone();

    let routing_mode = settings.routing_mode.as_str();
    let normalized_routing_mode = if routing_mode == "selected" {
        "apps_domains"
    } else {
        routing_mode
    };
    let split_enabled = normalized_routing_mode != "all";
    let include_apps =
        normalized_routing_mode == "apps_domains" || normalized_routing_mode == "apps";
    let include_domains =
        normalized_routing_mode == "apps_domains" || normalized_routing_mode == "domains";
    let mut split_debug: Option<(String, usize, usize, usize, usize)> = None;

    // Check for full Clash YAML config
    let custom_config = match parse_clash_config(&current_profile.config_link)? {
        Some(ClashConfig::Full(yaml_str)) => Some(yaml_str),
        _ => None,
    };

    let final_config_yaml = if let Some(yaml_str) = custom_config {
        yaml_str
    } else {
        // Build Clash YAML config from parsed proxy link
        let mut exit_proxy = parse_outbound(&current_profile.config_link, &settings)?;
        exit_proxy.insert(ystr("name"), ystr("proxy"));
        let mut winbox_target = "proxy".to_string();
        let mut winbox_proxy: Option<serde_yaml::Mapping> = None;

        let mut proxies: Vec<YValue> = Vec::new();
        let mut proxy_names: Vec<YValue> = vec![ystr("proxy")];

        // Proxy chain support
        if settings.proxy_chain_enabled {
            let mut seen = HashSet::new();
            for (index, chain_id) in settings.proxy_chain.iter().enumerate() {
                if chain_id == &current_profile.id || !seen.insert(chain_id.clone()) {
                    continue;
                }
                if let Some(profile) = profiles.iter().find(|p| p.id == *chain_id) {
                    let mut chain_proxy = parse_outbound(&profile.config_link, &settings)?;
                    let tag = format!("chain-{}", index + 1);
                    chain_proxy.insert(ystr("name"), ystr(&tag));
                    if index > 0 {
                        chain_proxy.insert(ystr("dialer-proxy"), ystr(&format!("chain-{}", index)));
                    }
                    proxies.push(YValue::Mapping(chain_proxy));
                    proxy_names.push(ystr(&tag));
                }
            }

            // Set dialer-proxy on exit proxy to chain through the last chain hop
            if !proxies.is_empty() {
                exit_proxy.insert(
                    ystr("dialer-proxy"),
                    ystr(&format!("chain-{}", proxies.len())),
                );
            }
        }

        if matches!(exit_proxy.get(&ystr("type")), Some(YValue::String(proxy_type)) if proxy_type == "vless")
            && matches!(exit_proxy.get(&ystr("flow")), Some(YValue::String(flow)) if flow == "xtls-rprx-vision")
        {
            let mut winbox_proxy_map = exit_proxy.clone();
            winbox_proxy_map.remove(&ystr("flow"));
            winbox_proxy_map.insert(ystr("name"), ystr("proxy-winbox"));
            winbox_target = "proxy-winbox".to_string();
            winbox_proxy = Some(winbox_proxy_map);
        }

        // Insert exit proxy at the beginning
        proxies.insert(0, YValue::Mapping(exit_proxy));
        if let Some(winbox_proxy_map) = winbox_proxy {
            proxies.insert(1, YValue::Mapping(winbox_proxy_map));
        }

        // Build rules
        let mut rules: Vec<YValue> = Vec::new();

        if split_enabled {
            if include_apps {
                let process_paths = extract_process_paths(&settings.routing_apps);
                let process_names =
                    merge_process_names(expand_process_names(&settings.routing_apps), &process_paths);
                split_debug = Some((
                    normalized_routing_mode.to_string(),
                    settings.routing_apps.len(),
                    process_names.len(),
                    process_paths.len(),
                    settings.routing_domains.len(),
                ));

                for name in &process_names {
                    rules.push(ystr(&format!("PROCESS-NAME,{},proxy", name)));
                }
            }
            if include_domains && !settings.routing_domains.is_empty() {
                for domain in &settings.routing_domains {
                    rules.push(ystr(&format!("DOMAIN-SUFFIX,{},proxy", domain)));
                }
            }
            if !include_apps && include_domains {
                split_debug = Some((
                    normalized_routing_mode.to_string(),
                    settings.routing_apps.len(),
                    0,
                    0,
                    settings.routing_domains.len(),
                ));
            }
            // Keep explicit Winbox routing in split mode only.
            rules.push(ystr(&format!("DST-PORT,8291,{}", winbox_target)));
            // Default to DIRECT in split mode
            rules.push(ystr("MATCH,DIRECT"));
        } else {
            // Route all through proxy in tunnel mode.
            // Keep rule count minimal to avoid surprising behavior for unmanaged traffic.
            rules.push(ystr("MATCH,proxy"));
        }

        // Build the full Clash config as YAML string
        let tun_device = if cfg!(target_os = "macos") {
            "utun1989"
        } else {
            "tun0"
        };

        let config_yaml = format!(
            r#"mixed-port: 7890
mode: rule
log-level: info
external-controller: 127.0.0.1:9090
ipv6: false

dns:
  enable: true
  ipv6: false
  listen: 127.0.0.1:53553
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - {dns}
  nameserver:
    - {dns}

tun:
  enable: true
  device-id: "{tun_device}"
  gateway: "198.19.0.1/24"
  gateway-v6: "fd00:fac::1/64"
  route-all: {route_all}
  dns-hijack: true

proxies:
{proxies_yaml}
rules:
{rules_yaml}
"#,
            dns = settings.dns,
            tun_device = tun_device,
            route_all = !split_enabled,
            proxies_yaml = proxies.iter()
                .map(|p| {
                    let yaml = serde_yaml::to_string(p).unwrap_or_default();
                    // Indent each proxy as a YAML list item
                    format!("  - {}", yaml.trim().replace('\n', "\n    "))
                })
                .collect::<Vec<_>>()
                .join("\n"),
            rules_yaml = rules.iter()
                .map(|r| format!("  - {}", r.as_str().unwrap_or("")))
                .collect::<Vec<_>>()
                .join("\n"),
        );

        config_yaml
    };

    let log_path = get_log_path(&app);
    let _ = File::create(&log_path);

    if let Some((mode, apps, names, paths, domains)) = split_debug {
        let _ = app.emit(
            "vpn-log",
            vec![
                format!(
                    "Split tunneling mode: {}, apps: {}, domains: {}",
                    mode, apps, domains
                ),
                format!(
                    "Process match entries: names={}, paths={}",
                    names, paths
                ),
            ],
        );
    }

    // Save config for debugging
    let config_path = app.path().app_cache_dir().unwrap().join("config.yaml");
    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut file = File::create(&config_path).map_err(|e| e.to_string())?;
    file.write_all(final_config_yaml.as_bytes())
        .map_err(|e| e.to_string())?;

    let cwd = app.path().app_cache_dir().unwrap().to_string_lossy().to_string();
    let log_file_path = log_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let executable_path = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        let command = format!(
            "\"{}\" --run-core --config \"{}\" --cwd \"{}\" --log \"{}\" > /dev/null 2>&1 &",
            executable_path,
            config_path.to_string_lossy(),
            cwd.clone(),
            log_file_path.clone()
        );

        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            command.replace("\"", "\\\"")
        );

        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .map_err(|e| e.to_string())?;

        if !status.success() {
            return Err("Failed to get administrator privileges or start VPN core".to_string());
        }

        // Wait up to 5 seconds for core.pid to ensure it started
        let mut attempts = 0;
        let pid_file = std::path::Path::new(&cwd).join("core.pid");
        while attempts < 50 {
            if pid_file.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            attempts += 1;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Start clash-rs in a background thread for non-macOS (start_scaffold is blocking)
        let config_yaml_clone = final_config_yaml.clone();
        let cwd_clone = cwd.clone();
        let log_file_clone = log_file_path.clone();
        std::thread::spawn(move || {
            let _ = clash_lib::start_scaffold(clash_lib::Options {
                config: clash_lib::Config::Str(config_yaml_clone),
                cwd: Some(cwd_clone),
                rt: Some(clash_lib::TokioRuntime::MultiThread),
                log_file: Some(log_file_clone),
            });
        });
    }

    {
        let mut running = state.is_running.lock().unwrap();
        *running = true;
    }

    let stop_signal = state.vpn_stop_signal.clone();
    stop_signal.store(false, Ordering::SeqCst);

    // Tail the log file and forward to frontend
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use std::io::{Read, Seek, SeekFrom};
        use tokio::time::Duration;

        let mut file = match File::open(&log_path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut pos = 0u64;

        loop {
            if stop_signal.load(Ordering::SeqCst) {
                break;
            }

            let mut contents = String::new();
            if file.seek(SeekFrom::Start(pos)).is_ok() {
                if file.read_to_string(&mut contents).is_ok() && !contents.is_empty() {
                    pos += contents.len() as u64;
                    let batch: Vec<String> = contents.lines().map(|l| l.to_string()).collect();
                    if !batch.is_empty() {
                        if app_handle.emit("vpn-log", batch).is_err() {
                            break;
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });

    Ok("VPN Started".to_string())
}

#[tauri::command]
pub fn stop_vpn(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.vpn_stop_signal.store(true, Ordering::SeqCst);

    let cwd = app.path().app_cache_dir().unwrap().to_string_lossy().to_string();
    
    #[cfg(target_os = "macos")]
    {
        let stop_file = std::path::Path::new(&cwd).join("core.stop");
        std::fs::write(&stop_file, "stop").unwrap_or_default();
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        // Shutdown clash-rs runtime directly
        clash_lib::shutdown();
    }

    let mut running = state.is_running.lock().unwrap();
    *running = false;
    Ok("VPN Stopped".to_string())
}
