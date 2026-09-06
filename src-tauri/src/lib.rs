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
fn strip_native_titlebar(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, new_long: isize) -> isize;
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    const GWL_STYLE: i32 = -16;
    const WS_CAPTION: isize = 0x00C0_0000;
    const WS_SYSMENU: isize = 0x0008_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;

    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    let Ok(hwnd) = window.hwnd() else { return; };
    let raw_hwnd = hwnd.0 as *mut c_void;

    unsafe {
        let style = GetWindowLongPtrW(raw_hwnd, GWL_STYLE);
        let stripped_style = style & !(WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);

        if stripped_style != style {
            let _ = SetWindowLongPtrW(raw_hwnd, GWL_STYLE, stripped_style);
            let _ = SetWindowPos(
                raw_hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn strip_native_titlebar(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn apply_native_window_material(window: &tauri::WebviewWindow) {
    use std::{ffi::c_void, mem::size_of};

    #[repr(C)]
    struct Margins {
        cx_left_width: i32,
        cx_right_width: i32,
        cy_top_height: i32,
        cy_bottom_height: i32,
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            dw_attribute: i32,
            pv_attribute: *const c_void,
            cb_attribute: u32,
        ) -> i32;
        fn DwmExtendFrameIntoClientArea(hwnd: *mut c_void, margins: *const Margins) -> i32;
    }

    // Windows 11 DWM attributes. Keeping the material and the rounded outline
    // in the same compositor avoids the old GDI SetWindowRgn / Acrylic mismatch.
    const DWMWA_WINDOW_CORNER_PREFERENCE: i32 = 33;
    const DWMWA_BORDER_COLOR: i32 = 34;
    const DWMWA_SYSTEMBACKDROP_TYPE: i32 = 38;

    const DWMWCP_ROUND: u32 = 2;
    const DWMSBT_TRANSIENTWINDOW: u32 = 3;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    let Ok(hwnd) = window.hwnd() else { return; };
    let raw_hwnd = hwnd.0 as *mut c_void;

    // A negative margin extends DWM's glass frame across the complete client
    // area. The WebView itself stays transparent, so React is rendered over a
    // single Desktop Acrylic surface instead of over a second browser blur.
    let margins = Margins {
        cx_left_width: -1,
        cx_right_width: -1,
        cy_top_height: -1,
        cy_bottom_height: -1,
    };

    unsafe {
        let _ = DwmExtendFrameIntoClientArea(raw_hwnd, &margins);
        let _ = DwmSetWindowAttribute(
            raw_hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &DWMSBT_TRANSIENTWINDOW as *const u32 as *const c_void,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            raw_hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_ROUND as *const u32 as *const c_void,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            raw_hwnd,
            DWMWA_BORDER_COLOR,
            &DWMWA_COLOR_NONE as *const u32 as *const c_void,
            size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_native_window_material(_window: &tauri::WebviewWindow) {}

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
                strip_native_titlebar(&window);
                apply_native_window_material(&window);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            #[cfg(target_os = "windows")]
            if matches!(
                event,
                WindowEvent::Focused(_)
                    | WindowEvent::Resized(_)
                    | WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Some(webview_window) = window.app_handle().get_webview_window("main") {
                    strip_native_titlebar(&webview_window);
                    apply_native_window_material(&webview_window);
                }
            }

            if matches!(event, WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Dayforge");
}
