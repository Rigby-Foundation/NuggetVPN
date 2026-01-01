use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use url::Url;

use crate::models::AppSettings;

pub fn strip_ansi_codes(s: &str) -> String {
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

pub fn extract_name_from_link(link: &str) -> String {
    if let Ok(parsed) = Url::parse(link) {
        let protocol = match parsed.scheme() {
            "vless" => "VLESS",
            "vmess" => "VMess",
            "trojan" => "Trojan",
            "ss" => "Shadowsocks",
            "ssr" => "ShadowsocksR",
            "hy" | "hysteria" => "Hysteria",
            "hy2" | "hysteria2" => "Hysteria2",
            "tuic" => "TUIC",
            "wg" | "wireguard" => "WireGuard",
            "socks" | "socks4" | "socks5" => "SOCKS",
            "http" | "https" => "HTTP",
            "ssh" => "SSH",
            other => other,
        };

        if let Some(host) = parsed.host_str() {
            return format!("{} ({})", host, protocol);
        }
    }
    "Imported Profile".to_string()
}

fn resolve_host(host: &str) -> String {
    // Let sing-box resolve the domain itself using configured DNS
    host.to_string()
}

fn apply_tls_settings(tls: &mut Value, settings: &AppSettings) {
    if settings.tls_fragment {
        tls["utls"]["tls_fragment"] = json!({
            "enabled": true,
            "size": settings.tls_fragment_size,
            "sleep": settings.tls_fragment_sleep
        });
    }
    if settings.tls_mixed_sni_case {
        tls["mixed_sni_case"] = json!(true);
    }
    if settings.tls_padding {
        tls["padding"] = json!(true);
    }
    if settings.sni_spoof_enabled && !settings.sni_spoof_value.is_empty() {
        tls["server_name"] = json!(settings.sni_spoof_value);
    }
}

fn add_transport(outbound: &mut Value, params: &HashMap<String, String>, domain: &str) {
    let transport_type = params.get("type").map(|s| s.as_str()).unwrap_or("tcp");

    match transport_type {
        "ws" => {
            let path = params.get("path").map(|s| s.as_str()).unwrap_or("/");
            let host = params.get("host").unwrap_or(&domain.to_string()).clone();
            outbound["transport"] = json!({
                "type": "ws",
                "path": path,
                "headers": { "Host": host },
                "max_early_data": 2048,
                "early_data_header_name": "Sec-WebSocket-Protocol"
            });
        }
        "grpc" => {
            let service_name = params.get("serviceName").map(|s| s.as_str()).unwrap_or("");
            outbound["transport"] = json!({
                "type": "grpc",
                "service_name": service_name
            });
        }
        "h2" | "http" => {
            let path = params.get("path").map(|s| s.as_str()).unwrap_or("/");
            let host = params.get("host").unwrap_or(&domain.to_string()).clone();
            outbound["transport"] = json!({
                "type": "http",
                "host": [host],
                "path": path
            });
        }
        "quic" => {
            outbound["transport"] = json!({
                "type": "quic"
            });
        }
        "httpupgrade" => {
            let path = params.get("path").map(|s| s.as_str()).unwrap_or("/");
            let host = params.get("host").unwrap_or(&domain.to_string()).clone();
            outbound["transport"] = json!({
                "type": "httpupgrade",
                "host": host,
                "path": path
            });
        }
        _ => {}
    }
}

pub fn parse_outbound(link: &str, settings: &AppSettings) -> Result<Value, String> {
    let url = Url::parse(link).map_err(|_| "Invalid URL format")?;
    let protocol = url.scheme();

    match protocol {
        "vless" => {
            let uuid = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);
            let transport_type = params.get("type").map(|s| s.as_str()).unwrap_or("tcp");

            let flow = if transport_type == "tcp" || transport_type == "" {
                params.get("flow").map(|s| s.as_str()).unwrap_or("")
            } else {
                ""
            };

            let mut outbound = json!({
                "type": "vless",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "uuid": uuid
            });

            if !flow.is_empty() {
                outbound["flow"] = json!(flow);
            }

            if let Some(security) = params.get("security") {
                if security == "reality" {
                    let mut tls = json!({
                        "enabled": true,
                        "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                        "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                        "reality": {
                            "enabled": true,
                            "public_key": params.get("pbk").unwrap_or(&"".to_string()),
                            "short_id": params.get("sid").unwrap_or(&"".to_string())
                        }
                    });
                    apply_tls_settings(&mut tls, settings);
                    outbound["tls"] = tls;
                } else if security == "tls" {
                    let alpn = params.get("alpn").map(|s| {
                        s.split(',').map(|v| v.to_string()).collect::<Vec<_>>()
                    });
                    let mut tls = json!({
                        "enabled": true,
                        "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                        "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                        "insecure": params.get("allowInsecure").map(|v| v == "1").unwrap_or(false)
                    });
                    if let Some(alpn_list) = alpn {
                        tls["alpn"] = json!(alpn_list);
                    }
                    apply_tls_settings(&mut tls, settings);
                    outbound["tls"] = tls;
                }
            }

            add_transport(&mut outbound, &params, domain);
            Ok(outbound)
        }
        "vmess" => {
            let link_body = link.strip_prefix("vmess://").ok_or("Invalid vmess link")?;
            let decoded = general_purpose::STANDARD
                .decode(link_body.trim())
                .or_else(|_| general_purpose::URL_SAFE.decode(link_body.trim()))
                .map_err(|_| "Failed to decode vmess link")?;
            let vmess_config: Value =
                serde_json::from_slice(&decoded).map_err(|_| "Failed to parse vmess JSON")?;

            let server = vmess_config["add"].as_str().unwrap_or("");
            let port = vmess_config["port"].as_u64().unwrap_or(443) as u16;
            let uuid = vmess_config["id"].as_str().unwrap_or("");
            let alter_id = vmess_config["aid"].as_u64().unwrap_or(0) as u32;
            let security = vmess_config["scy"].as_str().unwrap_or("auto");
            let net = vmess_config["net"].as_str().unwrap_or("tcp");
            let tls_type = vmess_config["tls"].as_str().unwrap_or("");
            let sni = vmess_config["sni"].as_str().unwrap_or(server);
            let host = vmess_config["host"].as_str().unwrap_or(server);
            let path = vmess_config["path"].as_str().unwrap_or("/");

            let resolved_ip = resolve_host(server);

            let mut outbound = json!({
                "type": "vmess",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "uuid": uuid,
                "alter_id": alter_id,
                "security": security
            });

            if tls_type == "tls" {
                let mut tls = json!({
                    "enabled": true,
                    "server_name": sni,
                    "utls": { "enabled": true, "fingerprint": "chrome" },
                    "insecure": false
                });
                apply_tls_settings(&mut tls, settings);
                outbound["tls"] = tls;
            }

            match net {
                "ws" => {
                    outbound["transport"] = json!({
                        "type": "ws",
                        "path": path,
                        "headers": { "Host": host },
                        "max_early_data": 2048,
                        "early_data_header_name": "Sec-WebSocket-Protocol"
                    });
                }
                "grpc" => {
                    outbound["transport"] = json!({
                        "type": "grpc",
                        "service_name": path.trim_start_matches('/')
                    });
                }
                "h2" | "http" => {
                    outbound["transport"] = json!({
                        "type": "http",
                        "host": [host],
                        "path": path
                    });
                }
                "quic" => {
                    outbound["transport"] = json!({
                        "type": "quic"
                    });
                }
                _ => {}
            }

            Ok(outbound)
        }
        "trojan" => {
            let password = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let mut outbound = json!({
                "type": "trojan",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "password": password
            });

            let sni = params.get("sni").unwrap_or(&domain.to_string()).clone();
            let alpn = params.get("alpn").map(|s| {
                s.split(',').map(|v| v.to_string()).collect::<Vec<_>>()
            });
            let mut tls = json!({
                "enabled": true,
                "server_name": sni,
                "utls": { "enabled": true, "fingerprint": params.get("fp").unwrap_or(&"chrome".to_string()) },
                "insecure": params.get("allowInsecure").map(|v| v == "1").unwrap_or(false)
            });
            if let Some(alpn_list) = alpn {
                tls["alpn"] = json!(alpn_list);
            }
            apply_tls_settings(&mut tls, settings);
            outbound["tls"] = tls;

            add_transport(&mut outbound, &params, domain);
            Ok(outbound)
        }
        "ss" => {
            let user_info = url.username();
            let host = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;

            let decoded_user = general_purpose::URL_SAFE
                .decode(user_info)
                .or_else(|_| general_purpose::STANDARD.decode(user_info))
                .map(|b| String::from_utf8(b).unwrap_or(user_info.to_string()))
                .unwrap_or(user_info.to_string());

            let parts: Vec<&str> = decoded_user.splitn(2, ':').collect();
            if parts.len() < 2 {
                return Err("Invalid SS format".to_string());
            }

            let resolved_ip = resolve_host(host);

            let mut outbound = json!({
                "type": "shadowsocks",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "method": parts[0],
                "password": parts[1]
            });

            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
            if let Some(plugin) = params.get("plugin") {
                if plugin.starts_with("v2ray-plugin") || plugin.starts_with("xray-plugin") {
                    let plugin_opts = params.get("plugin-opts").map(|s| s.as_str()).unwrap_or("");
                    let opts: HashMap<_, _> = plugin_opts
                        .split(';')
                        .filter_map(|kv| {
                            let mut parts = kv.splitn(2, '=');
                            Some((parts.next()?, parts.next().unwrap_or("")))
                        })
                        .collect();

                    let mode = opts.get("mode").unwrap_or(&"websocket");
                    if *mode == "websocket" {
                        let path = opts.get("path").unwrap_or(&"/");
                        let ws_host = opts.get("host").unwrap_or(&host);
                        outbound["plugin"] = json!("v2ray-plugin");
                        outbound["plugin_opts"] =
                            json!(format!("mode=websocket;host={};path={}", ws_host, path));
                    }
                }
            }

            Ok(outbound)
        }
        "hy2" | "hysteria2" => {
            let password = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

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
                if obfs != "none" && !obfs.is_empty() {
                    outbound["obfs"] = json!({
                        "type": obfs,
                        "password": params.get("obfs-password").unwrap_or(&"".to_string())
                    });
                }
            }

            Ok(outbound)
        }
        "hysteria" | "hy" => {
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let auth_str = params.get("auth").map(|s| s.as_str()).unwrap_or("");
            let up_mbps = params
                .get("upmbps")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(100);
            let down_mbps = params
                .get("downmbps")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(100);

            let mut outbound = json!({
                "type": "hysteria",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "auth_str": auth_str,
                "up_mbps": up_mbps,
                "down_mbps": down_mbps,
                "tls": {
                    "enabled": true,
                    "server_name": params.get("peer").or(params.get("sni")).unwrap_or(&domain.to_string()),
                    "insecure": params.get("insecure").map(|v| v == "1").unwrap_or(false)
                }
            });

            if let Some(obfs) = params.get("obfs") {
                if !obfs.is_empty() {
                    outbound["obfs"] = json!(obfs);
                }
            }

            if let Some(alpn) = params.get("alpn") {
                outbound["tls"]["alpn"] = json!(alpn.split(',').collect::<Vec<_>>());
            }

            Ok(outbound)
        }
        "tuic" => {
            let uuid = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let congestion = params
                .get("congestion_control")
                .map(|s| s.as_str())
                .unwrap_or("bbr");
            let udp_relay_mode = params
                .get("udp_relay_mode")
                .map(|s| s.as_str())
                .unwrap_or("native");

            let mut outbound = json!({
                "type": "tuic",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "uuid": uuid,
                "password": password,
                "congestion_control": congestion,
                "udp_relay_mode": udp_relay_mode,
                "tls": {
                    "enabled": true,
                    "server_name": params.get("sni").unwrap_or(&domain.to_string()),
                    "insecure": params.get("allow_insecure").map(|v| v == "1").unwrap_or(false)
                }
            });

            if let Some(alpn) = params.get("alpn") {
                outbound["tls"]["alpn"] = json!(alpn.split(',').collect::<Vec<_>>());
            }

            Ok(outbound)
        }
        "wireguard" => {
            let private_key = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let local_addr = params
                .get("address")
                .or(params.get("ip"))
                .map(|s| s.split(',').map(|v| v.trim().to_string()).collect::<Vec<_>>())
                .unwrap_or_else(|| vec!["10.0.0.2/32".to_string()]);

            let mut outbound = json!({
                "type": "wireguard",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "private_key": private_key,
                "peer_public_key": params.get("publickey").or(params.get("public_key")).unwrap_or(&"".to_string()),
                "local_address": local_addr,
                "mtu": params.get("mtu").and_then(|v| v.parse::<u32>().ok()).unwrap_or(1280)
            });

            if let Some(reserved) = params.get("reserved") {
                let reserved_bytes: Vec<u8> = reserved
                    .split(',')
                    .filter_map(|v| v.trim().parse::<u8>().ok())
                    .collect();
                if reserved_bytes.len() == 3 {
                    outbound["reserved"] = json!(reserved_bytes);
                }
            }

            Ok(outbound)
        }
        "socks" | "socks5" | "socks4" => {
            let username = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;

            let resolved_ip = resolve_host(domain);

            let version = if protocol == "socks4" { "4" } else { "5" };

            let mut outbound = json!({
                "type": "socks",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "version": version
            });

            if !username.is_empty() {
                outbound["username"] = json!(username);
                outbound["password"] = json!(password);
            }

            Ok(outbound)
        }
        "http" | "https" => {
            let username = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().unwrap_or(if protocol == "https" { 443 } else { 80 });

            let resolved_ip = resolve_host(domain);

            let mut outbound = json!({
                "type": "http",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port
            });

            if !username.is_empty() {
                outbound["username"] = json!(username);
                outbound["password"] = json!(password);
            }

            if protocol == "https" {
                outbound["tls"] = json!({
                    "enabled": true,
                    "server_name": domain
                });
            }

            Ok(outbound)
        }
        "ssh" => {
            let username = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().unwrap_or(22);
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let resolved_ip = resolve_host(domain);

            let mut outbound = json!({
                "type": "ssh",
                "tag": "proxy",
                "server": resolved_ip,
                "server_port": port,
                "user": username
            });

            if let Some(password) = url.password() {
                outbound["password"] = json!(password);
            }

            if let Some(pk) = params.get("private_key") {
                outbound["private_key"] = json!(pk);
            }

            if let Some(pk_pass) = params.get("private_key_passphrase") {
                outbound["private_key_passphrase"] = json!(pk_pass);
            }

            if let Some(host_key) = params.get("host_key") {
                outbound["host_key"] = json!(host_key.split(',').collect::<Vec<_>>());
            }

            Ok(outbound)
        }
        _ => Err(format!("Protocol {} not supported", protocol)),
    }
}

pub fn detect_protocol(link: &str) -> &'static str {
    if link.starts_with("vless://") {
        "vless"
    } else if link.starts_with("vmess://") {
        "vmess"
    } else if link.starts_with("trojan://") {
        "trojan"
    } else if link.starts_with("ss://") {
        "shadowsocks"
    } else if link.starts_with("hy2://") || link.starts_with("hysteria2://") {
        "hysteria2"
    } else if link.starts_with("hy://") || link.starts_with("hysteria://") {
        "hysteria"
    } else if link.starts_with("tuic://") {
        "tuic"
    } else if link.starts_with("wireguard://") {
        "wireguard"
    } else if link.starts_with("socks://")
        || link.starts_with("socks5://")
        || link.starts_with("socks4://")
    {
        "socks"
    } else if link.starts_with("http://") || link.starts_with("https://") {
        "http"
    } else if link.starts_with("ssh://") {
        "ssh"
    } else {
        "unknown"
    }
}
