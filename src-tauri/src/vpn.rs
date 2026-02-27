use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::models::AppState;
use crate::parser::{parse_outbound, parse_singbox_config, strip_ansi_codes, SingBoxConfig};
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

fn ensure_clash_api(config: &mut Value) {
    let controller = json!({
        "external_controller": "127.0.0.1:9090"
    });

    if let Some(exp) = config.get_mut("experimental") {
        if exp.get("clash_api").is_some() {
            return;
        }
        if let Some(obj) = exp.as_object_mut() {
            obj.insert("clash_api".to_string(), controller);
            return;
        }
    }

    config["experimental"] = json!({
        "clash_api": {
            "external_controller": "127.0.0.1:9090"
        }
    });
}

fn migrate_singbox_config(config: &mut Value) {
    // Remove legacy special outbounds (block, dns) deprecated in sing-box 1.11.0
    let mut removed_tags: HashMap<String, String> = HashMap::new();
    let mut direct_tags: HashSet<String> = HashSet::new();
    if let Some(outbounds) = config.get_mut("outbounds").and_then(|v| v.as_array_mut()) {
        outbounds.retain(|ob| {
            let ob_type = ob.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let ob_tag = ob.get("tag").and_then(|v| v.as_str()).unwrap_or("");
            if ob_type == "direct" {
                direct_tags.insert(ob_tag.to_string());
            }
            match ob_type {
                "block" => {
                    removed_tags.insert(ob_tag.to_string(), "block".to_string());
                    false
                }
                "dns" => {
                    removed_tags.insert(ob_tag.to_string(), "dns".to_string());
                    false
                }
                _ => true,
            }
        });
    }

    // Convert route rules referencing removed outbounds to action-based rules
    if !removed_tags.is_empty() {
        if let Some(rules) = config
            .get_mut("route")
            .and_then(|r| r.get_mut("rules"))
            .and_then(|v| v.as_array_mut())
        {
            for rule in rules.iter_mut() {
                let outbound = match rule.get("outbound").and_then(|v| v.as_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                if let Some(removed_type) = removed_tags.get(&outbound) {
                    if let Some(obj) = rule.as_object_mut() {
                        obj.remove("outbound");
                        match removed_type.as_str() {
                            "block" => { obj.insert("action".to_string(), json!("reject")); }
                            "dns" => { obj.insert("action".to_string(), json!("hijack-dns")); }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    // Migrate legacy DNS server format (address field) to new format (type + server)
    if let Some(servers) = config
        .get_mut("dns")
        .and_then(|d| d.get_mut("servers"))
        .and_then(|v| v.as_array_mut())
    {
        for server in servers.iter_mut() {
            if server.get("type").and_then(|v| v.as_str()).is_some() {
                continue;
            }
            let Some(address) = server.get("address").and_then(|v| v.as_str()).map(String::from) else {
                continue;
            };
            if let Some(obj) = server.as_object_mut() {
                obj.remove("address");
                obj.remove("address_resolver");
                obj.remove("address_strategy");
                obj.remove("address_fallback_delay");

                if address == "local" {
                    obj.insert("type".to_string(), json!("local"));
                } else if let Some(rest) = address.strip_prefix("dhcp://") {
                    obj.insert("type".to_string(), json!("dhcp"));
                    if !rest.is_empty() && rest != "auto" {
                        obj.insert("interface".to_string(), json!(rest));
                    }
                } else if address == "fakeip" {
                    obj.insert("type".to_string(), json!("fakeip"));
                } else if let Some(rest) = address.strip_prefix("tls://") {
                    obj.insert("type".to_string(), json!("tls"));
                    obj.insert("server".to_string(), json!(rest));
                } else if let Some(rest) = address.strip_prefix("tcp://") {
                    obj.insert("type".to_string(), json!("tcp"));
                    obj.insert("server".to_string(), json!(rest));
                } else if let Some(rest) = address.strip_prefix("https://") {
                    obj.insert("type".to_string(), json!("https"));
                    let parts: Vec<&str> = rest.splitn(2, '/').collect();
                    obj.insert("server".to_string(), json!(parts[0]));
                } else if let Some(rest) = address.strip_prefix("h3://") {
                    obj.insert("type".to_string(), json!("h3"));
                    let parts: Vec<&str> = rest.splitn(2, '/').collect();
                    obj.insert("server".to_string(), json!(parts[0]));
                } else if let Some(rest) = address.strip_prefix("quic://") {
                    obj.insert("type".to_string(), json!("quic"));
                    obj.insert("server".to_string(), json!(rest));
                } else {
                    obj.insert("type".to_string(), json!("udp"));
                    obj.insert("server".to_string(), json!(address));
                }
            }
        }
    }

    // Remove detour from DNS servers pointing to direct-type outbounds (deprecated in 1.12.0)
    if let Some(servers) = config
        .get_mut("dns")
        .and_then(|d| d.get_mut("servers"))
        .and_then(|v| v.as_array_mut())
    {
        for server in servers.iter_mut() {
            if let Some(detour) = server.get("detour").and_then(|v| v.as_str()).map(String::from) {
                if direct_tags.contains(&detour) {
                    if let Some(obj) = server.as_object_mut() {
                        obj.remove("detour");
                    }
                }
            }
        }
    }

    // Remove legacy DNS rules with "outbound" field (deprecated in 1.12.0)
    if let Some(rules) = config
        .get_mut("dns")
        .and_then(|d| d.get_mut("rules"))
        .and_then(|v| v.as_array_mut())
    {
        rules.retain(|rule| rule.get("outbound").is_none());
    }

    // Ensure default_domain_resolver is set in route config (required since 1.12.0)
    if config.get("route").is_some()
        && config.get("route").and_then(|r| r.get("default_domain_resolver")).is_none()
    {
        if let Some(first_tag) = config
            .get("dns")
            .and_then(|d| d.get("servers"))
            .and_then(|v| v.as_array())
            .and_then(|servers| servers.first())
            .and_then(|s| s.get("tag"))
            .and_then(|v| v.as_str())
        {
            let tag = first_tag.to_string();
            config["route"]["default_domain_resolver"] = json!(tag);
        }
    }

    // Migrate legacy inbound sniff/sniff_override_destination to route rule actions
    if let Some(inbounds) = config.get_mut("inbounds").and_then(|v| v.as_array_mut()) {
        let mut sniff_rules: Vec<Value> = Vec::new();
        for inbound in inbounds.iter_mut() {
            let has_sniff = inbound.get("sniff").and_then(|v| v.as_bool()).unwrap_or(false);
            if !has_sniff {
                continue;
            }
            let override_dest = inbound
                .get("sniff_override_destination")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let tag = inbound.get("tag").and_then(|v| v.as_str()).map(String::from);

            if let Some(obj) = inbound.as_object_mut() {
                obj.remove("sniff");
                obj.remove("sniff_override_destination");
                obj.remove("sniff_timeout");
            }

            let mut sniff_rule = json!({ "action": "sniff" });
            if override_dest {
                sniff_rule["override_destination"] = json!(true);
            }
            if let Some(ref t) = tag {
                sniff_rule["inbound"] = json!(t);
            }
            sniff_rules.push(sniff_rule);
        }

        if !sniff_rules.is_empty() {
            if let Some(rules) = config
                .get_mut("route")
                .and_then(|r| r.get_mut("rules"))
                .and_then(|v| v.as_array_mut())
            {
                for (i, rule) in sniff_rules.into_iter().enumerate() {
                    rules.insert(i, rule);
                }
            }
        }
    }
}

#[tauri::command]
pub fn start_vpn(
    app: AppHandle,
    window: Window,
    state: State<AppState>,
    profile_id: Option<String>,
) -> Result<String, String> {
    let mut running = state.is_running.lock().unwrap();
    if *running {
        return Err("Already running".to_string());
    }

    let profiles = state.profiles.lock().unwrap();
    let selected_id = profile_id.as_deref().filter(|id| !id.is_empty());
    let current_profile = selected_id
        .and_then(|id| profiles.iter().find(|p| p.id == id))
        .or_else(|| profiles.first())
        .ok_or("No profiles found")?;
    let settings = state.settings.lock().unwrap();
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
    let stack_mode = if include_apps && cfg!(target_os = "macos") {
        "system"
    } else {
        "mixed"
    };
    let mut split_debug: Option<(String, usize, usize, usize, usize)> = None;

    let custom_config = match parse_singbox_config(&current_profile.config_link)? {
        Some(SingBoxConfig::Full(config)) => Some(config),
        _ => None,
    };

    let final_config = if let Some(mut config) = custom_config {
        ensure_clash_api(&mut config);
        migrate_singbox_config(&mut config);
        config
    } else {
        let mut chain_profiles = Vec::new();
        if settings.proxy_chain_enabled {
            let mut seen = HashSet::new();
            for chain_id in &settings.proxy_chain {
                if chain_id == &current_profile.id {
                    continue;
                }
                if !seen.insert(chain_id.clone()) {
                    continue;
                }
                if let Some(profile) = profiles.iter().find(|p| p.id == *chain_id) {
                    chain_profiles.push(profile);
                }
            }
        }

        let mut exit_outbound = parse_outbound(&current_profile.config_link, &settings)?;
        exit_outbound["tag"] = json!("proxy");

        let mut chain_outbounds = Vec::new();
        for (index, profile) in chain_profiles.iter().enumerate() {
            let mut outbound = parse_outbound(&profile.config_link, &settings)?;
            let tag = format!("proxy-chain-{}", index + 1);
            outbound["tag"] = json!(tag);
            if index > 0 {
                outbound["detour"] = json!(format!("proxy-chain-{}", index));
            }
            chain_outbounds.push(outbound);
        }

        if !chain_outbounds.is_empty() {
            exit_outbound["detour"] =
                json!(format!("proxy-chain-{}", chain_outbounds.len()));
        }

        let mut outbounds = Vec::new();
        outbounds.push(exit_outbound);
        outbounds.extend(chain_outbounds);
        outbounds.push(json!({ "type": "direct", "tag": "direct" }));

        let (dns_servers, dns_final) = if cfg!(target_os = "windows") {
            (
                json!([
                    {
                        "tag": "dns-direct",
                        "type": "udp",
                        "server": settings.dns,
                        "server_port": 53
                    }
                ]),
                "dns-direct",
            )
        } else {
            (
                json!([
                    { "tag": "local", "type": "local" },
                    {
                        "tag": "remote",
                        "type": "https",
                        "server": settings.dns,
                        "server_port": 443,
                        "path": "/dns-query",
                        "detour": "proxy"
                    }
                ]),
                "remote",
            )
        };

        let mut config = json!({
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
                "servers": dns_servers,
                "rules": [
                    { "action": "route", "server": if cfg!(target_os = "windows") { "dns-direct" } else { "local" } }
                ],
                "final": dns_final,
                "strategy": "prefer_ipv4"
            },
            "inbounds": [{
                "type": "tun",
                "tag": "tun-in",
                "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
                "mtu": settings.mtu,
                "auto_route": true,
                "strict_route": true,
                "stack": stack_mode
            }],
            "outbounds": outbounds,
            "route": {
                "auto_detect_interface": true,
                "default_domain_resolver": if cfg!(target_os = "windows") { "dns-direct" } else { "local" },
                "final": if split_enabled { "direct" } else { "proxy" },
                "rules": [
                    { "action": "sniff", "override_destination": true },
                    { "protocol": "dns", "action": "hijack-dns" },
                    { "ip_cidr": [format!("{}/32", settings.dns)], "action": "direct" },
                    { "ip_is_private": true, "action": "direct" }
                ]
            }
        });

        if split_enabled {
            if let Some(rules) = config["route"]["rules"].as_array_mut() {
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

                    if !process_names.is_empty() {
                        rules.insert(0, json!({
                            "process_name": process_names,
                            "outbound": "proxy"
                        }));
                    }
                    if !process_paths.is_empty() {
                        rules.insert(0, json!({
                            "process_path": process_paths,
                            "outbound": "proxy"
                        }));
                    }
                }
                if include_domains && !settings.routing_domains.is_empty() {
                    rules.insert(0, json!({
                        "domain_suffix": settings.routing_domains,
                        "outbound": "proxy"
                    }));
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
            }
        }

        config
    };

    let log_path = get_log_path(&app);

    let _ = File::create(&log_path);

    if let Some((mode, apps, names, paths, domains)) = split_debug {
        let _ = window.emit(
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
