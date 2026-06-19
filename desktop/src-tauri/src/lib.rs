use tauri::Manager;

pub fn run() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{SettingsExt, WebViewExt};
                let win = app.get_webview_window("main").unwrap();
                win.with_webview(|wv| {
                    let settings = wv.inner().settings().unwrap();
                    settings.set_hardware_acceleration_policy(
                        webkit2gtk::HardwareAccelerationPolicy::Never,
                    );
                })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Marmo");
}
