use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
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

fn database_migrations() -> Vec<Migration> {
    vec![Migration {
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
    }]
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
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ))?;

                let show_item = MenuItem::with_id(app, "show", "Show Dayforge", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit Dayforge", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let mut tray = TrayIconBuilder::new()
                    .menu(&menu)
                    .menu_on_left_click(false)
                    .tooltip("Dayforge")
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }

                tray.build(app)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dayforge");
}
