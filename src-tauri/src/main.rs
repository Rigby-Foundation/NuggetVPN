#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--run-core".to_string()) {
        nuggetvpn_lib::run_core();
        return;
    }
    nuggetvpn_lib::run()
}
