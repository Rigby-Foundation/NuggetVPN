use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::models::{AppSettings, AppState, Profile};
use crate::parser::{detect_protocol, extract_name_from_link};
use crate::storage::{load_profiles_from_disk, save_profiles_to_disk};

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
        let protocol = detect_protocol(link);
        if protocol == "unknown" {
            continue;
        }

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
