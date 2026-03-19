use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use serde_json::json;
use tauri::State;
use url::Url;

use crate::models::{AppSettings, AppState, Profile};
use crate::parser::{detect_protocol, extract_name_from_link};
use crate::storage::{load_profiles_from_disk, save_profiles_to_disk};

const SUBSCRIPTION_USER_AGENT: &str = "curl/8.7.1 NuggetVPN/1.0";

#[derive(Serialize, Deserialize)]
struct AuthResponse {
    token: Option<String>,
    message: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ServerProfile {
    id: String,
    name: String,
    hash: String,
    encryption_type: String,
    updated_at: String,
}

#[derive(Serialize)]
pub struct SubscriptionRefreshSummary {
    pub refreshed: usize,
    pub failed: usize,
    pub skipped: usize,
}

fn split_subscription_payload(payload: &str) -> Vec<String> {
    payload
        .lines()
        .filter_map(|line| {
            let link = line.trim();
            if link.is_empty() || link.starts_with('#') {
                return None;
            }
            if link.contains(".time:") || link.contains("fake_ip") {
                return None;
            }
            if link.contains("@127.0.0.1:")
                || link.contains("00000000-0000-0000-0000-000000000000")
            {
                return None;
            }
            Some(link.replace("&amp;", "&"))
        })
        .collect()
}

fn decode_subscription_body(raw: &str) -> String {
    let trimmed = raw.trim();
    let clean_for_b64 = trimmed.replace('\n', "").replace('\r', "");
    general_purpose::STANDARD
        .decode(&clean_for_b64)
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(&clean_for_b64))
        .or_else(|_| general_purpose::URL_SAFE.decode(&clean_for_b64))
        .or_else(|_| general_purpose::URL_SAFE_NO_PAD.decode(&clean_for_b64))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| trimmed.to_string())
}

fn load_subscription_links(raw: &str) -> Vec<String> {
    split_subscription_payload(&decode_subscription_body(raw))
}

fn collect_subscription_sources(snapshot: &[Profile]) -> HashMap<String, String> {
    let mut source_to_url: HashMap<String, String> = HashMap::new();
    let mut legacy_urls: HashMap<String, String> = HashMap::new();

    for profile in snapshot {
        let source = profile.source_domain.trim();
        if source.is_empty() || source == "local" {
            continue;
        }

        let sub_url = profile.subscription_url.trim();
        if sub_url.is_empty() {
            if let Ok(parsed) = Url::parse(&profile.config_link) {
                if parsed.scheme() == "http" || parsed.scheme() == "https" {
                    legacy_urls
                        .entry(source.to_string())
                        .or_insert_with(|| profile.config_link.trim().to_string());
                }
            }
            continue;
        }

        source_to_url
            .entry(source.to_string())
            .or_insert_with(|| sub_url.to_string());
    }

    for (source, sub_url) in legacy_urls {
        source_to_url.entry(source).or_insert(sub_url);
    }

    source_to_url
}

fn build_subscription_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(SUBSCRIPTION_USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

async fn refresh_subscriptions(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    only_domain: Option<&str>,
) -> Result<SubscriptionRefreshSummary, String> {
    let snapshot = { state.profiles.lock().unwrap().clone() };
    let mut source_to_url = collect_subscription_sources(&snapshot);
    let strict_mode = only_domain.is_some();

    if let Some(domain) = only_domain {
        let normalized = domain.trim();
        if normalized.is_empty() || normalized == "local" {
            return Err("Invalid subscription domain".to_string());
        }

        let maybe_url = source_to_url.remove(normalized);
        source_to_url.clear();
        if let Some(url) = maybe_url {
            source_to_url.insert(normalized.to_string(), url);
        } else {
            return Err(format!(
                "Subscription URL not found for domain '{}'. Re-import this subscription once, then refresh will work.",
                normalized
            ));
        }
    }

    if source_to_url.is_empty() {
        return Ok(SubscriptionRefreshSummary {
            refreshed: 0,
            failed: 0,
            skipped: 0,
        });
    }

    let client = build_subscription_client()?;
    let mut refreshed = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;

    for (source_domain, sub_url) in source_to_url {
        let parsed_url = match Url::parse(&sub_url) {
            Ok(url) => url,
            Err(error) => {
                if strict_mode {
                    return Err(format!(
                        "Saved subscription URL is invalid for '{}': {}",
                        source_domain, error
                    ));
                }
                skipped += 1;
                continue;
            }
        };
        let host = match parsed_url.host_str() {
            Some(host) if !host.is_empty() => host,
            _ => {
                if strict_mode {
                    return Err(format!(
                        "Saved subscription URL for '{}' has no host",
                        source_domain
                    ));
                }
                skipped += 1;
                continue;
            }
        };
        if host != source_domain {
            if strict_mode {
                return Err(format!(
                    "Saved subscription URL host '{}' does not match source '{}'",
                    host, source_domain
                ));
            }
            skipped += 1;
            continue;
        }

        let response = match client.get(&sub_url).send().await {
            Ok(response) => response,
            Err(error) => {
                if strict_mode {
                    return Err(format!(
                        "Failed to request subscription '{}': {}",
                        source_domain, error
                    ));
                }
                failed += 1;
                continue;
            }
        };
        if !response.status().is_success() {
            if strict_mode {
                let status = response.status();
                let preview = response.text().await.unwrap_or_default();
                let preview = preview.chars().take(180).collect::<String>();
                return Err(format!(
                    "Subscription server '{}' returned {}: {}",
                    source_domain, status, preview
                ));
            }
            failed += 1;
            continue;
        }
        let body = match response.text().await {
            Ok(text) => text,
            Err(error) => {
                if strict_mode {
                    return Err(format!(
                        "Failed to read subscription response for '{}': {}",
                        source_domain, error
                    ));
                }
                failed += 1;
                continue;
            }
        };

        let links = load_subscription_links(&body);
        if links.is_empty() {
            if strict_mode {
                let preview = body
                    .lines()
                    .take(6)
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(220)
                    .collect::<String>();
                return Err(format!(
                    "Subscription '{}' returned no links. Response preview: {}",
                    source_domain, preview
                ));
            }
            failed += 1;
            continue;
        }

        let mut fresh_profiles = Vec::new();
        for link in links {
            let protocol = detect_protocol(&link);
            if protocol == "unknown" {
                continue;
            }
            fresh_profiles.push(Profile {
                id: uuid::Uuid::new_v4().to_string(),
                name: extract_name_from_link(&link),
                server: "Auto".to_string(),
                protocol: protocol.to_string(),
                config_link: link,
                source_domain: source_domain.clone(),
                subscription_url: sub_url.clone(),
                total_up: Some(0),
                total_down: Some(0),
            });
        }

        if fresh_profiles.is_empty() {
            if strict_mode {
                return Err(format!(
                    "Subscription '{}' has links, but none are supported",
                    source_domain
                ));
            }
            failed += 1;
            continue;
        }

        {
            let mut profiles = state.profiles.lock().unwrap();
            profiles.retain(|profile| profile.source_domain.trim() != source_domain);
            profiles.extend(fresh_profiles);
            save_profiles_to_disk(app, &profiles);
        }
        refreshed += 1;
    }

    if strict_mode && refreshed == 0 {
        return Err("Subscription refresh finished, but no profiles were updated".to_string());
    }

    Ok(SubscriptionRefreshSummary {
        refreshed,
        failed,
        skipped,
    })
}

#[tauri::command]
pub async fn login_user(
    server: String,
    username: String,
    password: String,
) -> Result<String, String> {
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
pub async fn register_user(
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

#[tauri::command]
pub async fn push_profiles_to_server(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<String, String> {
    let server = settings.auth_server.ok_or("No auth server configured")?;
    let token = settings.auth_token.ok_or("No auth token configured")?;

    let profiles = load_profiles_from_disk(&app);
    let client = reqwest::Client::new();
    let url = format!("{}/profiles", server.trim_end_matches('/'));

    for profile in profiles {
        let profile_json = serde_json::to_string(&profile).map_err(|e| e.to_string())?;

        let res = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&json!({
                "name": profile.name,
                "hash": profile_json,
                "encryption_type": "json"
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Failed to push profile {}: {}", profile.name, text));
        }
    }

    Ok("All profiles pushed successfully".to_string())
}

#[tauri::command]
pub async fn pull_profiles_from_server(
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
        match serde_json::from_str::<Profile>(&sp.hash) {
            Ok(p) => {
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

#[tauri::command]
pub async fn import_subscription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<Profile>, String> {
    let parsed_url = Url::parse(&url).map_err(|_| "Invalid subscription URL")?;
    let source_domain = parsed_url
        .host_str()
        .ok_or("Subscription URL missing host")?
        .to_string();

    let client = build_subscription_client()?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let links = load_subscription_links(&text);

    let mut profiles = state.profiles.lock().unwrap();
    let mut added = false;

    for link in links {
        let protocol = detect_protocol(&link);
        if protocol == "unknown" {
            continue;
        }

        profiles.push(Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: extract_name_from_link(&link),
            server: "Auto".to_string(),
            protocol: protocol.to_string(),
            config_link: link.to_string(),
            source_domain: source_domain.clone(),
            subscription_url: url.clone(),
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

#[tauri::command]
pub async fn refresh_subscriptions_on_startup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SubscriptionRefreshSummary, String> {
    refresh_subscriptions(&app, &state, None).await
}

#[tauri::command]
pub async fn refresh_subscription_by_domain(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_domain: String,
) -> Result<SubscriptionRefreshSummary, String> {
    refresh_subscriptions(&app, &state, Some(&source_domain)).await
}
