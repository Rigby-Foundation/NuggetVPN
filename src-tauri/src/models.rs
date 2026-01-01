use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub server: String,
    pub protocol: String,
    pub config_link: String,
    pub total_up: Option<u64>,
    pub total_down: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub mtu: u32,
    pub dns: String,
    pub tls_fragment: bool,
    pub tls_fragment_size: String,
    pub tls_fragment_sleep: String,
    pub tls_mixed_sni_case: bool,
    pub tls_padding: bool,
    #[serde(default)]
    pub sni_spoof_enabled: bool,
    #[serde(default)]
    pub sni_spoof_value: String,
    #[serde(default)]
    pub auth_server: Option<String>,
    #[serde(default)]
    pub auth_token: Option<String>,
    #[serde(default)]
    pub skip_auth: bool,
    #[serde(default)]
    pub pending_sync_upload: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            mtu: 9000,
            dns: "1.1.1.1".to_string(),
            tls_fragment: false,
            tls_fragment_size: "100-200".to_string(),
            tls_fragment_sleep: "10-20".to_string(),
            tls_mixed_sni_case: false,
            tls_padding: false,
            sni_spoof_enabled: false,
            sni_spoof_value: String::new(),
            auth_server: None,
            auth_token: None,
            skip_auth: false,
            pending_sync_upload: false,
        }
    }
}

pub struct AppState {
    pub profiles: Mutex<Vec<Profile>>,
    pub settings: Mutex<AppSettings>,
    pub is_running: Mutex<bool>,
}
