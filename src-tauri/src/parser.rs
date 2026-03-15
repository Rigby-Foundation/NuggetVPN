use base64::{engine::general_purpose, Engine as _};
use serde_yaml::Value as YValue;
use serde_json::Value as JValue;
use std::collections::{HashMap, HashSet};
use url::Url;

use crate::models::AppSettings;

/// Clash full config provided as YAML string
#[derive(Debug)]
pub enum ClashConfig {
    Full(String),
    Proxy(YValue),
}

/// Try to parse input as a Clash YAML config or a single proxy entry.
pub fn parse_clash_config(input: &str) -> Result<Option<ClashConfig>, String> {
    let trimmed = input.trim();

    // Check for YAML-like content (starts with a mapping key or document marker)
    if !trimmed.starts_with("proxies:")
        && !trimmed.starts_with("port:")
        && !trimmed.starts_with("mixed-port:")
        && !trimmed.starts_with("---")
        && !trimmed.starts_with("socks-port:")
    {
        // Also try JSON sing-box format for backwards compat during migration
        if trimmed.starts_with('{') {
            // Accept JSON payloads and let parse_outbound() convert sing-box
            // outbounds into a Clash proxy entry.
            let _jval: JValue =
                serde_json::from_str(trimmed).map_err(|e| format!("Invalid JSON: {}", e))?;
            return Ok(None);
        }
        return Ok(None);
    }

    // It looks like Clash YAML
    let val: YValue = serde_yaml::from_str(trimmed)
        .map_err(|e| format!("Invalid Clash YAML: {}", e))?;

    if val.get("proxies").is_some() || val.get("rules").is_some() || val.get("port").is_some() {
        return Ok(Some(ClashConfig::Full(trimmed.to_string())));
    }

    if val.get("type").is_some() && val.get("name").is_some() {
        return Ok(Some(ClashConfig::Proxy(val)));
    }

    Err("Unrecognized Clash YAML format".to_string())
}

pub fn extract_name_from_link(link: &str) -> String {
    let normalized = link.replace("&amp;", "&");
    let trimmed = normalized.trim();

    if let Some(name) = extract_name_from_singbox_json(trimmed) {
        return name;
    }

    if let Some(name) = extract_vmess_name_from_link(trimmed) {
        return name;
    }

    if let Ok(parsed) = Url::parse(trimmed) {
        if let Some(fragment) = parsed
            .fragment()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            return fragment.to_string();
        }

        let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
        if let Some(name) = preferred_link_name(&params) {
            return name;
        }

        let protocol = protocol_display_name(parsed.scheme());
        if let Some(host) = parsed.host_str().filter(|host| !host.trim().is_empty()) {
            return format!("{} ({})", host, protocol);
        }
    }
    "Imported Profile".to_string()
}

fn protocol_display_name(protocol: &str) -> &str {
    match protocol {
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
    }
}

fn singbox_outbound_type(outbound: &JValue) -> &str {
    outbound.get("type").and_then(|v| v.as_str()).unwrap_or("")
}

fn singbox_outbound_tag<'a>(outbound: &'a JValue) -> Option<&'a str> {
    outbound
        .get("tag")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
}

fn singbox_is_selector_like(outbound_type: &str) -> bool {
    matches!(outbound_type, "selector" | "urltest" | "fallback")
}

fn singbox_is_supported_conversion_type(outbound_type: &str) -> bool {
    matches!(outbound_type, "vless" | "vmess" | "trojan" | "shadowsocks")
}

fn singbox_outbound_has_endpoint(outbound: &JValue) -> bool {
    let has_server = outbound
        .get("server")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|server| !server.is_empty())
        .is_some();
    let has_port = outbound
        .get("server_port")
        .and_then(|v| v.as_u64())
        .or_else(|| outbound.get("port").and_then(|v| v.as_u64()))
        .is_some();
    has_server && has_port
}

fn singbox_find_outbound_by_tag<'a>(outbounds: &'a [JValue], tag: &str) -> Option<&'a JValue> {
    outbounds
        .iter()
        .find(|outbound| singbox_outbound_tag(outbound) == Some(tag))
}

fn resolve_singbox_leaf_by_tag<'a>(
    outbounds: &'a [JValue],
    tag: &str,
    visited: &mut HashSet<String>,
) -> Option<&'a JValue> {
    let normalized_tag = tag.trim();
    if normalized_tag.is_empty() {
        return None;
    }
    if !visited.insert(normalized_tag.to_string()) {
        return None;
    }

    let outbound = singbox_find_outbound_by_tag(outbounds, normalized_tag)?;
    let outbound_type = singbox_outbound_type(outbound);
    if singbox_is_selector_like(outbound_type) {
        if let Some(default_tag) = outbound
            .get("default")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            if let Some(resolved) = resolve_singbox_leaf_by_tag(outbounds, default_tag, visited) {
                return Some(resolved);
            }
        }

        if let Some(nested) = outbound.get("outbounds").and_then(|v| v.as_array()) {
            for nested_tag in nested.iter().filter_map(|v| v.as_str()) {
                if let Some(resolved) = resolve_singbox_leaf_by_tag(outbounds, nested_tag, visited)
                {
                    return Some(resolved);
                }
            }
        }
        None
    } else {
        Some(outbound)
    }
}

fn select_singbox_outbound<'a>(json: &'a JValue) -> Result<&'a JValue, String> {
    let Some(outbounds) = json.get("outbounds").and_then(|v| v.as_array()) else {
        return Err("No supported outbound found in sing-box config".to_string());
    };

    let mut preferred_tags: Vec<String> = Vec::new();
    if let Some(final_tag) = json
        .get("route")
        .and_then(|v| v.as_object())
        .and_then(|route| route.get("final"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        preferred_tags.push(final_tag.to_string());
    }
    preferred_tags.extend(["proxy", "select", "auto"].iter().map(|tag| tag.to_string()));

    for tag in preferred_tags {
        let mut visited = HashSet::new();
        if let Some(outbound) = resolve_singbox_leaf_by_tag(outbounds, &tag, &mut visited) {
            let outbound_type = singbox_outbound_type(outbound);
            if singbox_is_supported_conversion_type(outbound_type)
                && singbox_outbound_has_endpoint(outbound)
            {
                return Ok(outbound);
            }
        }
    }

    for outbound in outbounds {
        if !singbox_is_selector_like(singbox_outbound_type(outbound)) {
            continue;
        }
        let Some(tag) = singbox_outbound_tag(outbound) else {
            continue;
        };
        let mut visited = HashSet::new();
        if let Some(resolved) = resolve_singbox_leaf_by_tag(outbounds, tag, &mut visited) {
            let outbound_type = singbox_outbound_type(resolved);
            if singbox_is_supported_conversion_type(outbound_type)
                && singbox_outbound_has_endpoint(resolved)
            {
                return Ok(resolved);
            }
        }
    }

    outbounds
        .iter()
        .find(|outbound| {
            let outbound_type = singbox_outbound_type(outbound);
            singbox_is_supported_conversion_type(outbound_type) && singbox_outbound_has_endpoint(outbound)
        })
        .ok_or("No supported outbound found in sing-box config".to_string())
}

fn preferred_link_name(params: &HashMap<String, String>) -> Option<String> {
    for key in [
        "serviceName",
        "service_name",
        "service-name",
        "remarks",
        "remark",
        "name",
        "ps",
        "tag",
    ] {
        if let Some(value) = params
            .get(key)
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
        {
            return Some(value.to_string());
        }
    }
    None
}

fn extract_vmess_name_from_link(link: &str) -> Option<String> {
    let payload = link.strip_prefix("vmess://")?.trim();
    let decoded = general_purpose::STANDARD
        .decode(payload)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    let vmess_config: JValue = serde_json::from_slice(&decoded).ok()?;
    vmess_config
        .get("ps")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn extract_name_from_singbox_json(input: &str) -> Option<String> {
    if !input.starts_with('{') {
        return None;
    }
    let json: JValue = serde_json::from_str(input).ok()?;
    let outbound = select_singbox_outbound(&json).ok()?;
    singbox_outbound_tag(outbound).map(str::to_string)
}

fn ystr(s: &str) -> YValue {
    YValue::String(s.to_string())
}

fn ynum(n: u64) -> YValue {
    YValue::Number(serde_yaml::Number::from(n))
}

fn ybool(b: bool) -> YValue {
    YValue::Bool(b)
}

/// Helper: create a YAML mapping from key-value pairs
fn ymapping(pairs: Vec<(&str, YValue)>) -> YValue {
    let mut map = serde_yaml::Mapping::new();
    for (k, v) in pairs {
        map.insert(ystr(k), v);
    }
    YValue::Mapping(map)
}

fn add_ws_opts(proxy: &mut serde_yaml::Mapping, params: &HashMap<String, String>, domain: &str) {
    let path = params.get("path").map(|s| s.as_str()).unwrap_or("/");
    let host = params.get("host").unwrap_or(&domain.to_string()).clone();
    let mut headers = serde_yaml::Mapping::new();
    headers.insert(ystr("Host"), ystr(&host));
    let ws_opts = ymapping(vec![
        ("path", ystr(path)),
        ("headers", YValue::Mapping(headers)),
        ("max-early-data", ynum(2048)),
        ("early-data-header-name", ystr("Sec-WebSocket-Protocol")),
    ]);
    proxy.insert(ystr("ws-opts"), ws_opts);
}

fn add_grpc_opts(proxy: &mut serde_yaml::Mapping, params: &HashMap<String, String>) {
    let service_name = get_param(
        params,
        &[
            "serviceName",
            "service_name",
            "service-name",
            "grpc-service-name",
            "service",
        ],
    )
    .unwrap_or("");
    let grpc_opts = ymapping(vec![
        ("grpc-service-name", ystr(service_name)),
    ]);
    proxy.insert(ystr("grpc-opts"), grpc_opts);
}

fn add_h2_opts(proxy: &mut serde_yaml::Mapping, params: &HashMap<String, String>, domain: &str) {
    let path = params.get("path").map(|s| s.as_str()).unwrap_or("/");
    let host = params.get("host").unwrap_or(&domain.to_string()).clone();
    let h2_opts = ymapping(vec![
        ("host", YValue::Sequence(vec![ystr(&host)])),
        ("path", ystr(path)),
    ]);
    proxy.insert(ystr("h2-opts"), h2_opts);
}

fn set_network_transport(proxy: &mut serde_yaml::Mapping, params: &HashMap<String, String>, domain: &str) {
    let transport_type = params.get("type").map(|s| s.as_str()).unwrap_or("tcp");
    match transport_type {
        "ws" => {
            proxy.insert(ystr("network"), ystr("ws"));
            add_ws_opts(proxy, params, domain);
        }
        "grpc" => {
            proxy.insert(ystr("network"), ystr("grpc"));
            add_grpc_opts(proxy, params);
        }
        "h2" | "http" => {
            proxy.insert(ystr("network"), ystr("h2"));
            add_h2_opts(proxy, params, domain);
        }
        _ => {}
    }
}

fn apply_sni_spoof(proxy: &mut serde_yaml::Mapping, settings: &AppSettings) {
    if settings.sni_spoof_enabled && !settings.sni_spoof_value.is_empty() {
        proxy.insert(ystr("sni"), ystr(&settings.sni_spoof_value));
        proxy.insert(ystr("servername"), ystr(&settings.sni_spoof_value));
    }
}

fn get_param<'a>(params: &'a HashMap<String, String>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| params.get(*key))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

fn add_grpc_opts_from_json(
    proxy: &mut serde_yaml::Mapping,
    transport: &serde_json::Map<String, JValue>,
) {
    let service_name = transport
        .get("service_name")
        .and_then(|v| v.as_str())
        .or_else(|| transport.get("serviceName").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    proxy.insert(
        ystr("grpc-opts"),
        ymapping(vec![("grpc-service-name", ystr(service_name))]),
    );
}

fn apply_singbox_transport(
    proxy: &mut serde_yaml::Mapping,
    outbound: &JValue,
    domain: &str,
) {
    let Some(transport) = outbound.get("transport").and_then(|v| v.as_object()) else {
        return;
    };
    let transport_type = transport
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("tcp");
    match transport_type {
        "ws" => {
            proxy.insert(ystr("network"), ystr("ws"));
            let path = transport
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("/");
            let host = transport
                .get("host")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    transport
                        .get("headers")
                        .and_then(|v| v.as_object())
                        .and_then(|headers| headers.get("Host"))
                        .and_then(|v| v.as_str())
                })
                .unwrap_or(domain);
            let mut headers = serde_yaml::Mapping::new();
            headers.insert(ystr("Host"), ystr(host));
            proxy.insert(
                ystr("ws-opts"),
                ymapping(vec![
                    ("path", ystr(path)),
                    ("headers", YValue::Mapping(headers)),
                ]),
            );
        }
        "grpc" => {
            proxy.insert(ystr("network"), ystr("grpc"));
            add_grpc_opts_from_json(proxy, transport);
        }
        "http" | "h2" => {
            proxy.insert(ystr("network"), ystr("h2"));
            let path = transport
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("/");
            let host = transport
                .get("host")
                .and_then(|v| v.as_str())
                .unwrap_or(domain);
            proxy.insert(
                ystr("h2-opts"),
                ymapping(vec![
                    ("host", YValue::Sequence(vec![ystr(host)])),
                    ("path", ystr(path)),
                ]),
            );
        }
        _ => {}
    }
}

fn parse_singbox_outbound(
    input: &str,
    settings: &AppSettings,
) -> Result<Option<serde_yaml::Mapping>, String> {
    let trimmed = input.trim();
    if !trimmed.starts_with('{') {
        return Ok(None);
    }
    let root: JValue = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid sing-box JSON: {}", e))?;
    if root.get("outbounds").and_then(|v| v.as_array()).is_none() {
        return Ok(None);
    }
    let outbound = select_singbox_outbound(&root)?;

    let outbound_type = outbound
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or("sing-box outbound is missing type".to_string())?;
    let server = outbound
        .get("server")
        .and_then(|v| v.as_str())
        .ok_or("sing-box outbound is missing server".to_string())?;
    let port = outbound
        .get("server_port")
        .and_then(|v| v.as_u64())
        .or_else(|| outbound.get("port").and_then(|v| v.as_u64()))
        .ok_or("sing-box outbound is missing server_port".to_string())?;

    let mut proxy = serde_yaml::Mapping::new();
    proxy.insert(ystr("name"), ystr("proxy"));
    proxy.insert(ystr("server"), ystr(server));
    proxy.insert(ystr("port"), ynum(port));

    match outbound_type {
        "vless" => {
            let uuid = outbound
                .get("uuid")
                .and_then(|v| v.as_str())
                .ok_or("sing-box vless outbound is missing uuid".to_string())?;
            proxy.insert(ystr("type"), ystr("vless"));
            proxy.insert(ystr("uuid"), ystr(uuid));
            if let Some(flow) = outbound
                .get("flow")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                proxy.insert(ystr("flow"), ystr(flow));
            }
        }
        "vmess" => {
            let uuid = outbound
                .get("uuid")
                .and_then(|v| v.as_str())
                .ok_or("sing-box vmess outbound is missing uuid".to_string())?;
            proxy.insert(ystr("type"), ystr("vmess"));
            proxy.insert(ystr("uuid"), ystr(uuid));
            proxy.insert(ystr("alterId"), ynum(0));
            let cipher = outbound
                .get("security")
                .and_then(|v| v.as_str())
                .unwrap_or("auto");
            proxy.insert(ystr("cipher"), ystr(cipher));
        }
        "trojan" => {
            let password = outbound
                .get("password")
                .and_then(|v| v.as_str())
                .ok_or("sing-box trojan outbound is missing password".to_string())?;
            proxy.insert(ystr("type"), ystr("trojan"));
            proxy.insert(ystr("password"), ystr(password));
        }
        "shadowsocks" => {
            let method = outbound
                .get("method")
                .and_then(|v| v.as_str())
                .ok_or("sing-box shadowsocks outbound is missing method".to_string())?;
            let password = outbound
                .get("password")
                .and_then(|v| v.as_str())
                .ok_or("sing-box shadowsocks outbound is missing password".to_string())?;
            proxy.insert(ystr("type"), ystr("ss"));
            proxy.insert(ystr("cipher"), ystr(method));
            proxy.insert(ystr("password"), ystr(password));
        }
        other => {
            return Err(format!(
                "sing-box outbound type '{}' is not supported for conversion yet",
                other
            ));
        }
    }

    if let Some(tls) = outbound.get("tls").and_then(|v| v.as_object()) {
        if tls.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
            proxy.insert(ystr("tls"), ybool(true));
            let sni = tls
                .get("server_name")
                .and_then(|v| v.as_str())
                .or_else(|| tls.get("sni").and_then(|v| v.as_str()))
                .unwrap_or(server);
            proxy.insert(ystr("servername"), ystr(sni));
            proxy.insert(ystr("sni"), ystr(sni));
            proxy.insert(
                ystr("skip-cert-verify"),
                ybool(tls.get("insecure").and_then(|v| v.as_bool()).unwrap_or(false)),
            );

            if let Some(alpn) = tls.get("alpn").and_then(|v| v.as_array()) {
                let alpn_list: Vec<YValue> = alpn
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(ystr)
                    .collect();
                if !alpn_list.is_empty() {
                    proxy.insert(ystr("alpn"), YValue::Sequence(alpn_list));
                }
            }

            if let Some(fp) = tls
                .get("utls")
                .and_then(|v| v.as_object())
                .and_then(|utls| utls.get("fingerprint"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                proxy.insert(ystr("client-fingerprint"), ystr(fp));
            }

            if let Some(reality) = tls.get("reality").and_then(|v| v.as_object()) {
                if reality
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    let mut reality_opts = serde_yaml::Mapping::new();
                    let public_key = reality
                        .get("public_key")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let short_id = reality
                        .get("short_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    reality_opts.insert(ystr("public-key"), ystr(public_key));
                    reality_opts.insert(ystr("short-id"), ystr(short_id));
                    proxy.insert(ystr("reality-opts"), YValue::Mapping(reality_opts));
                }
            }
        }
    }

    apply_singbox_transport(&mut proxy, outbound, server);
    apply_sni_spoof(&mut proxy, settings);
    Ok(Some(proxy))
}

/// Parse a proxy link into a Clash-format YAML mapping.
/// Returns a serde_yaml::Mapping suitable for inclusion in the `proxies:` list.
pub fn parse_outbound(link: &str, settings: &AppSettings) -> Result<serde_yaml::Mapping, String> {
    let link = &link.replace("&amp;", "&");

    // Check if it's already a Clash YAML proxy entry
    if let Some(parsed) = parse_clash_config(link)? {
        return match parsed {
            ClashConfig::Proxy(val) => {
                val.as_mapping().cloned().ok_or("Expected YAML mapping".to_string())
            }
            ClashConfig::Full(_) => Err(
                "Full Clash config cannot be used as a single proxy".to_string(),
            ),
        };
    }

    if let Some(proxy) = parse_singbox_outbound(link, settings)? {
        return Ok(proxy);
    }

    let url = Url::parse(link).map_err(|_| "Invalid URL format")?;
    let protocol = url.scheme();

    match protocol {
        "vless" => {
            let uuid = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
            let transport_type = params.get("type").map(|s| s.as_str()).unwrap_or("tcp");

            let flow = if transport_type == "tcp" || transport_type.is_empty() {
                params.get("flow").map(|s| s.as_str()).unwrap_or("")
            } else {
                ""
            };
            let client_fingerprint = ["fp", "fingerprint", "client-fingerprint"]
                .iter()
                .find_map(|k| params.get(*k))
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("vless"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("uuid"), ystr(uuid));

            if !flow.is_empty() {
                proxy.insert(ystr("flow"), ystr(flow));
            }
            if let Some(fp) = client_fingerprint {
                proxy.insert(ystr("client-fingerprint"), ystr(fp));
            }

            if let Some(security) = params.get("security") {
                if security == "reality" || security == "tls" {
                    proxy.insert(ystr("tls"), ybool(true));
                    let sni = params.get("sni").unwrap_or(&domain.to_string()).clone();
                    proxy.insert(ystr("servername"), ystr(&sni));
                    let skip = params.get("allowInsecure").map(|v| v == "1").unwrap_or(false);
                    proxy.insert(ystr("skip-cert-verify"), ybool(skip));
                    if let Some(alpn_str) = params.get("alpn") {
                        let alpn_list: Vec<YValue> = alpn_str.split(',').map(|v| ystr(v)).collect();
                        proxy.insert(ystr("alpn"), YValue::Sequence(alpn_list));
                    }
                }
                if security == "reality" {
                    let mut reality_opts = serde_yaml::Mapping::new();
                    reality_opts.insert(ystr("public-key"), ystr(params.get("pbk").unwrap_or(&"".to_string())));
                    reality_opts.insert(ystr("short-id"), ystr(params.get("sid").unwrap_or(&"".to_string())));
                    proxy.insert(ystr("reality-opts"), YValue::Mapping(reality_opts));
                }
            }

            set_network_transport(&mut proxy, &params, domain);
            apply_sni_spoof(&mut proxy, settings);
            Ok(proxy)
        }
        "vmess" => {
            let link_body = link.strip_prefix("vmess://").ok_or("Invalid vmess link")?;
            let decoded = general_purpose::STANDARD
                .decode(link_body.trim())
                .or_else(|_| general_purpose::URL_SAFE.decode(link_body.trim()))
                .map_err(|_| "Failed to decode vmess link")?;
            let vmess_config: JValue =
                serde_json::from_slice(&decoded).map_err(|_| "Failed to parse vmess JSON")?;

            let server = vmess_config["add"].as_str().unwrap_or("");
            let port = vmess_config["port"].as_u64().unwrap_or(443) as u16;
            let uuid = vmess_config["id"].as_str().unwrap_or("");
            let alter_id = vmess_config["aid"].as_u64().unwrap_or(0) as u16;
            let security = vmess_config["scy"].as_str().unwrap_or("auto");
            let net = vmess_config["net"].as_str().unwrap_or("tcp");
            let tls_type = vmess_config["tls"].as_str().unwrap_or("");
            let sni = vmess_config["sni"].as_str().unwrap_or(server);
            let host = vmess_config["host"].as_str().unwrap_or(server);
            let path = vmess_config["path"].as_str().unwrap_or("/");

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("vmess"));
            proxy.insert(ystr("server"), ystr(server));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("uuid"), ystr(uuid));
            proxy.insert(ystr("alterId"), ynum(alter_id as u64));
            proxy.insert(ystr("cipher"), ystr(security));

            if tls_type == "tls" {
                proxy.insert(ystr("tls"), ybool(true));
                proxy.insert(ystr("servername"), ystr(sni));
                proxy.insert(ystr("skip-cert-verify"), ybool(false));
            }

            match net {
                "ws" => {
                    proxy.insert(ystr("network"), ystr("ws"));
                    let mut headers = serde_yaml::Mapping::new();
                    headers.insert(ystr("Host"), ystr(host));
                    let ws_opts = ymapping(vec![
                        ("path", ystr(path)),
                        ("headers", YValue::Mapping(headers)),
                        ("max-early-data", ynum(2048)),
                        ("early-data-header-name", ystr("Sec-WebSocket-Protocol")),
                    ]);
                    proxy.insert(ystr("ws-opts"), ws_opts);
                }
                "grpc" => {
                    proxy.insert(ystr("network"), ystr("grpc"));
                    let grpc_opts = ymapping(vec![
                        ("grpc-service-name", ystr(path.trim_start_matches('/'))),
                    ]);
                    proxy.insert(ystr("grpc-opts"), grpc_opts);
                }
                "h2" | "http" => {
                    proxy.insert(ystr("network"), ystr("h2"));
                    let h2_opts = ymapping(vec![
                        ("host", YValue::Sequence(vec![ystr(host)])),
                        ("path", ystr(path)),
                    ]);
                    proxy.insert(ystr("h2-opts"), h2_opts);
                }
                _ => {}
            }

            apply_sni_spoof(&mut proxy, settings);
            Ok(proxy)
        }
        "trojan" => {
            let password = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("trojan"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("password"), ystr(password));

            let sni = params.get("sni").unwrap_or(&domain.to_string()).clone();
            proxy.insert(ystr("sni"), ystr(&sni));
            let skip = params.get("allowInsecure").map(|v| v == "1").unwrap_or(false);
            proxy.insert(ystr("skip-cert-verify"), ybool(skip));

            if let Some(alpn_str) = params.get("alpn") {
                let alpn_list: Vec<YValue> = alpn_str.split(',').map(|v| ystr(v)).collect();
                proxy.insert(ystr("alpn"), YValue::Sequence(alpn_list));
            }

            set_network_transport(&mut proxy, &params, domain);
            apply_sni_spoof(&mut proxy, settings);
            Ok(proxy)
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

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("ss"));
            proxy.insert(ystr("server"), ystr(host));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("cipher"), ystr(parts[0]));
            proxy.insert(ystr("password"), ystr(parts[1]));

            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
            if let Some(plugin) = params.get("plugin") {
                if plugin.starts_with("v2ray-plugin") || plugin.starts_with("xray-plugin") {
                    let plugin_opts_str = params.get("plugin-opts").map(|s| s.as_str()).unwrap_or("");
                    let opts: HashMap<_, _> = plugin_opts_str
                        .split(';')
                        .filter_map(|kv| {
                            let mut parts = kv.splitn(2, '=');
                            Some((parts.next()?, parts.next().unwrap_or("")))
                        })
                        .collect();

                    let mode = opts.get("mode").unwrap_or(&"websocket");
                    if *mode == "websocket" {
                        proxy.insert(ystr("plugin"), ystr("v2ray-plugin"));
                        let mut popts = serde_yaml::Mapping::new();
                        popts.insert(ystr("mode"), ystr("websocket"));
                        popts.insert(ystr("host"), ystr(opts.get("host").unwrap_or(&host)));
                        popts.insert(ystr("path"), ystr(opts.get("path").unwrap_or(&"/")));
                        proxy.insert(ystr("plugin-opts"), YValue::Mapping(popts));
                    }
                }
            }

            Ok(proxy)
        }
        "hy2" | "hysteria2" => {
            let password = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("hysteria2"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("password"), ystr(password));

            let sni = params.get("sni").unwrap_or(&domain.to_string()).clone();
            proxy.insert(ystr("sni"), ystr(&sni));
            let skip = params.get("insecure").map(|v| v == "1").unwrap_or(false);
            proxy.insert(ystr("skip-cert-verify"), ybool(skip));

            if let Some(obfs) = params.get("obfs") {
                if obfs != "none" && !obfs.is_empty() {
                    proxy.insert(ystr("obfs"), ystr(obfs));
                    if let Some(obfs_pw) = params.get("obfs-password") {
                        proxy.insert(ystr("obfs-password"), ystr(obfs_pw));
                    }
                }
            }

            Ok(proxy)
        }
        "hysteria" | "hy" => {
            // Hysteria v1 — clash-rs supports hysteria2 natively;
            // map v1 as hysteria2 with best-effort field mapping
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let auth_str = params.get("auth").map(|s| s.as_str()).unwrap_or("");
            let up_mbps = params.get("upmbps").and_then(|v| v.parse::<u64>().ok()).unwrap_or(100);
            let down_mbps = params.get("downmbps").and_then(|v| v.parse::<u64>().ok()).unwrap_or(100);

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("hysteria2"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("password"), ystr(auth_str));
            proxy.insert(ystr("up"), ynum(up_mbps));
            proxy.insert(ystr("down"), ynum(down_mbps));

            let sni = params.get("peer")
                .or(params.get("sni"))
                .unwrap_or(&domain.to_string())
                .clone();
            proxy.insert(ystr("sni"), ystr(&sni));
            let skip = params.get("insecure").map(|v| v == "1").unwrap_or(false);
            proxy.insert(ystr("skip-cert-verify"), ybool(skip));

            if let Some(alpn_str) = params.get("alpn") {
                let alpn_list: Vec<YValue> = alpn_str.split(',').map(|v| ystr(v)).collect();
                proxy.insert(ystr("alpn"), YValue::Sequence(alpn_list));
            }

            if let Some(obfs) = params.get("obfs") {
                if !obfs.is_empty() {
                    proxy.insert(ystr("obfs"), ystr(obfs));
                }
            }

            Ok(proxy)
        }
        "tuic" => {
            let uuid = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let congestion = params.get("congestion_control").map(|s| s.as_str()).unwrap_or("bbr");
            let udp_relay_mode = params.get("udp_relay_mode").map(|s| s.as_str()).unwrap_or("native");

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("tuic"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("uuid"), ystr(uuid));
            proxy.insert(ystr("password"), ystr(password));
            proxy.insert(ystr("congestion-controller"), ystr(congestion));
            proxy.insert(ystr("udp-relay-mode"), ystr(udp_relay_mode));

            let sni = params.get("sni").unwrap_or(&domain.to_string()).clone();
            proxy.insert(ystr("sni"), ystr(&sni));
            let skip = params.get("allow_insecure").map(|v| v == "1").unwrap_or(false);
            proxy.insert(ystr("skip-cert-verify"), ybool(skip));

            if let Some(alpn_str) = params.get("alpn") {
                let alpn_list: Vec<YValue> = alpn_str.split(',').map(|v| ystr(v)).collect();
                proxy.insert(ystr("alpn"), YValue::Sequence(alpn_list));
            }

            Ok(proxy)
        }
        "wireguard" => {
            let private_key = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let ip = params.get("address")
                .or(params.get("ip"))
                .map(|s| {
                    s.split(',').next().unwrap_or("10.0.0.2/32").trim().to_string()
                })
                .unwrap_or_else(|| "10.0.0.2/32".to_string());

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("wireguard"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("private-key"), ystr(private_key));
            proxy.insert(ystr("public-key"), ystr(
                params.get("publickey").or(params.get("public_key")).unwrap_or(&"".to_string())
            ));
            proxy.insert(ystr("ip"), ystr(&ip));

            let mtu = params.get("mtu").and_then(|v| v.parse::<u64>().ok()).unwrap_or(1280);
            proxy.insert(ystr("mtu"), ynum(mtu));

            if let Some(reserved) = params.get("reserved") {
                let reserved_bytes: Vec<YValue> = reserved
                    .split(',')
                    .filter_map(|v| v.trim().parse::<u64>().ok())
                    .map(ynum)
                    .collect();
                if reserved_bytes.len() == 3 {
                    proxy.insert(ystr("reserved"), YValue::Sequence(reserved_bytes));
                }
            }

            Ok(proxy)
        }
        "socks" | "socks5" | "socks4" => {
            let username = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().ok_or("No port")?;

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("socks5"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));

            if !username.is_empty() {
                proxy.insert(ystr("username"), ystr(username));
                proxy.insert(ystr("password"), ystr(password));
            }

            Ok(proxy)
        }
        "http" | "https" => {
            let username = url.username();
            let password = url.password().unwrap_or("");
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().unwrap_or(if protocol == "https" { 443 } else { 80 });

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("http"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));

            if !username.is_empty() {
                proxy.insert(ystr("username"), ystr(username));
                proxy.insert(ystr("password"), ystr(password));
            }

            if protocol == "https" {
                proxy.insert(ystr("tls"), ybool(true));
                proxy.insert(ystr("sni"), ystr(domain));
            }

            Ok(proxy)
        }
        "ssh" => {
            let username = url.username();
            let domain = url.host_str().ok_or("No host")?;
            let port = url.port().unwrap_or(22);
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();

            let mut proxy = serde_yaml::Mapping::new();
            proxy.insert(ystr("name"), ystr("proxy"));
            proxy.insert(ystr("type"), ystr("ssh"));
            proxy.insert(ystr("server"), ystr(domain));
            proxy.insert(ystr("port"), ynum(port as u64));
            proxy.insert(ystr("username"), ystr(username));

            if let Some(password) = url.password() {
                proxy.insert(ystr("password"), ystr(password));
            }

            if let Some(pk) = params.get("private_key") {
                proxy.insert(ystr("private-key"), ystr(pk));
            }

            if let Some(pk_pass) = params.get("private_key_passphrase") {
                proxy.insert(ystr("private-key-passphrase"), ystr(pk_pass));
            }

            if let Some(host_key) = params.get("host_key") {
                let keys: Vec<YValue> = host_key.split(',').map(|v| ystr(v)).collect();
                proxy.insert(ystr("host-key"), YValue::Sequence(keys));
            }

            Ok(proxy)
        }
        _ => Err(format!("Protocol {} not supported", protocol)),
    }
}

pub fn detect_protocol(link: &str) -> &'static str {
    let trimmed = link.trim();
    if trimmed.starts_with("proxies:") || trimmed.starts_with("port:") || trimmed.starts_with("---") {
        return "clash-yaml";
    }
    if trimmed.starts_with('{') {
        if let Ok(json) = serde_json::from_str::<JValue>(trimmed) {
            if json.get("outbounds").is_some() {
                return "sing-box";
            }
        }
    }
    if trimmed.starts_with("vless://") {
        "vless"
    } else if trimmed.starts_with("vmess://") {
        "vmess"
    } else if trimmed.starts_with("trojan://") {
        "trojan"
    } else if trimmed.starts_with("ss://") {
        "shadowsocks"
    } else if trimmed.starts_with("hy2://") || trimmed.starts_with("hysteria2://") {
        "hysteria2"
    } else if trimmed.starts_with("hy://") || trimmed.starts_with("hysteria://") {
        "hysteria"
    } else if trimmed.starts_with("tuic://") {
        "tuic"
    } else if trimmed.starts_with("wireguard://") {
        "wireguard"
    } else if trimmed.starts_with("socks://")
        || trimmed.starts_with("socks5://")
        || trimmed.starts_with("socks4://")
    {
        "socks"
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        "http"
    } else if trimmed.starts_with("ssh://") {
        "ssh"
    } else {
        "unknown"
    }
}
