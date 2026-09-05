use tauri::{Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(target_os = "windows")]
fn suppress_native_window_frame(window: &tauri::WebviewWindow) {
    use std::{ffi::c_void, mem::size_of};

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            dw_attribute: i32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    // The visible shape belongs to our HWND region, not to a second DWM corner
    // treatment. Keeping DWM rounding disabled prevents a second radius from
    // being composited around the WebView.
    const DWMWA_WINDOW_CORNER_PREFERENCE: i32 = 33;
    const DWMWA_BORDER_COLOR: i32 = 34;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    if let Ok(hwnd) = window.hwnd() {
        let raw_hwnd = hwnd.0 as *mut c_void;
        unsafe {
            let _ = DwmSetWindowAttribute(
                raw_hwnd,
                DWMWA_BORDER_COLOR,
                &DWMWA_COLOR_NONE as *const u32 as *const c_void,
                size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                raw_hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &DWMWCP_DONOTROUND as *const u32 as *const c_void,
                size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn clip_native_window_to_glass(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRoundRectRgn(
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
            width_ellipse: i32,
            height_ellipse: i32,
        ) -> *mut c_void;
        fn DeleteObject(object: *mut c_void) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else { return; };
    let Ok(size) = window.inner_size() else { return; };
    let Ok(scale) = window.scale_factor() else { return; };

    let logical_width = size.width as f64 / scale;
    let radius_logical = if logical_width <= 320.0 {
        24.0
    } else if logical_width >= 980.0 {
        26.0
    } else {
        24.0 + 2.0 * ((logical_width - 320.0) / (980.0 - 320.0))
    };
    let ellipse = (radius_logical * 2.0 * scale).round().max(1.0) as i32;

    unsafe {
        let region = CreateRoundRectRgn(
            0,
            0,
            size.width as i32 + 1,
            size.height as i32 + 1,
            ellipse,
            ellipse,
        );
        if region.is_null() {
            return;
        }

        // After a successful SetWindowRgn call Windows owns the HRGN. Only
        // delete it ourselves when the call fails.
        if SetWindowRgn(hwnd.0 as *mut c_void, region, 1) == 0 {
            let _ = DeleteObject(region);
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_native_frost(window: &tauri::WebviewWindow) {
    use std::{ffi::c_void, mem::{size_of, transmute}};

    #[repr(C)]
    struct AccentPolicy {
        accent_state: i32,
        accent_flags: i32,
        gradient_color: u32,
        animation_id: i32,
    }

    #[repr(C)]
    struct WindowCompositionAttribData {
        attribute: i32,
        data: *mut c_void,
        size: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(module_name: *const u16) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, proc_name: *const u8) -> *mut c_void;
    }

    type SetWindowCompositionAttributeFn = unsafe extern "system" fn(
        hwnd: *mut c_void,
        data: *mut WindowCompositionAttribData,
    ) -> i32;

    const WCA_ACCENT_POLICY: i32 = 19;
    const ACCENT_ENABLE_BLURBEHIND: i32 = 3;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: i32 = 4;

    let Ok(hwnd) = window.hwnd() else { return; };

    // SetWindowCompositionAttribute is intentionally not linked as a normal
    // user32 import: some Windows SDK import libraries do not export it. Resolve
    // it at runtime instead so release builds and older SDKs remain link-safe.
    let user32_name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
    let module = unsafe { GetModuleHandleW(user32_name.as_ptr()) };
    if module.is_null() {
        return;
    }

    let proc = unsafe {
        GetProcAddress(
            module,
            b"SetWindowCompositionAttribute\0".as_ptr(),
        )
    };
    if proc.is_null() {
        return;
    }

    let set_window_composition_attribute: SetWindowCompositionAttributeFn =
        unsafe { transmute(proc) };

    // AccentPolicy uses AABBGGRR. A low-alpha neutral white gives the blur a
    // milky optical scatter without turning the UI gray or creating a second
    // system-backdrop surface. The HWND region clips this same layer.
    let mut acrylic_policy = AccentPolicy {
        accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        accent_flags: 0,
        gradient_color: 0x20FF_FFFF,
        animation_id: 0,
    };
    let mut acrylic_data = WindowCompositionAttribData {
        attribute: WCA_ACCENT_POLICY,
        data: &mut acrylic_policy as *mut AccentPolicy as *mut c_void,
        size: size_of::<AccentPolicy>(),
    };

    let acrylic_result = unsafe {
        set_window_composition_attribute(hwnd.0 as *mut c_void, &mut acrylic_data)
    };

    if acrylic_result == 0 {
        // Older Windows builds can reject acrylic. Fall back to native blur
        // behind, still on the same clipped HWND rather than another surface.
        let mut blur_policy = AccentPolicy {
            accent_state: ACCENT_ENABLE_BLURBEHIND,
            accent_flags: 0,
            gradient_color: 0,
            animation_id: 0,
        };
        let mut blur_data = WindowCompositionAttribData {
            attribute: WCA_ACCENT_POLICY,
            data: &mut blur_policy as *mut AccentPolicy as *mut c_void,
            size: size_of::<AccentPolicy>(),
        };
        unsafe {
            let _ = set_window_composition_attribute(
                hwnd.0 as *mut c_void,
                &mut blur_data,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn suppress_native_window_frame(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
fn clip_native_window_to_glass(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
fn apply_native_frost(_window: &tauri::WebviewWindow) {}

fn database_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_dayforge_core_schema",
            sql: r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS app_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  task_type TEXT NOT NULL CHECK(task_type IN ('daily', 'persistent')),
                  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  completed_at TEXT NULL
                );

                CREATE TABLE IF NOT EXISTS task_completions (
                  id TEXT PRIMARY KEY,
                  task_id TEXT NOT NULL,
                  date_key TEXT NOT NULL,
                  completed_at TEXT NOT NULL,
                  UNIQUE(task_id, date_key),
                  FOREIGN KEY(task_id) REFERENCES tasks(id)
                );

                CREATE TABLE IF NOT EXISTS habits (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
                  reward_cap_per_day INTEGER NULL,
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS habit_checkins (
                  id TEXT PRIMARY KEY,
                  habit_id TEXT NOT NULL,
                  checked_in_at TEXT NOT NULL,
                  date_key TEXT NOT NULL,
                  exp_eligible INTEGER NOT NULL DEFAULT 1,
                  FOREIGN KEY(habit_id) REFERENCES habits(id)
                );

                CREATE TABLE IF NOT EXISTS timer_sessions (
                  id TEXT PRIMARY KEY,
                  category TEXT NOT NULL,
                  difficulty TEXT NOT NULL CHECK(difficulty IN ('easy', 'medium', 'hard')),
                  started_at TEXT NOT NULL,
                  ended_at TEXT NULL,
                  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
                  status TEXT NOT NULL,
                  exp_awarded INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS sleep_records (
                  id TEXT PRIMARY KEY,
                  date_key TEXT NOT NULL UNIQUE,
                  bedtime TEXT NOT NULL,
                  wake_time TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS experience_logs (
                  id TEXT PRIMARY KEY,
                  source_type TEXT NOT NULL,
                  source_id TEXT NULL,
                  description TEXT NOT NULL,
                  amount INTEGER NOT NULL,
                  occurred_at TEXT NOT NULL,
                  date_key TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_experience_logs_date_key
                ON experience_logs(date_key);

                CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_timer_session_titles",
            sql: r#"
                ALTER TABLE timer_sessions
                ADD COLUMN title TEXT NOT NULL DEFAULT 'Focus session';

                UPDATE timer_sessions
                SET title = category || ' session'
                WHERE title = 'Focus session';

                CREATE INDEX IF NOT EXISTS idx_timer_sessions_ended_at
                ON timer_sessions(ended_at);
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

pub fn run() {
    let sql_plugin = tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:dayforge.db", database_migrations())
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(sql_plugin)
        .invoke_handler(tauri::generate_handler![quit_app])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                suppress_native_window_frame(&window);
                clip_native_window_to_glass(&window);
                apply_native_frost(&window);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            #[cfg(target_os = "windows")]
            if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                if let Some(webview_window) = window.app_handle().get_webview_window("main") {
                    clip_native_window_to_glass(&webview_window);
                    if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
                        apply_native_frost(&webview_window);
                    }
                }
            }

            if matches!(event, WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Dayforge");
}
