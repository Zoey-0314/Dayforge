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

    // Let the transparent WebView stay rectangular and let CSS own the only
    // visible rounded mask. A second DWM rounding radius creates tiny corner
    // seams because Windows' system radius cannot exactly match our 25px glass.
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

#[cfg(not(target_os = "windows"))]
fn suppress_native_window_frame(_window: &tauri::WebviewWindow) {}

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
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Dayforge");
}
