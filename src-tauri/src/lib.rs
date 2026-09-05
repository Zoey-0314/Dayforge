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
fn strip_native_non_client_frame(window: &tauri::WebviewWindow) {
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
    const GWL_EXSTYLE: i32 = -20;

    const WS_CAPTION: isize = 0x00C0_0000;
    const WS_THICKFRAME: isize = 0x0004_0000;
    const WS_SYSMENU: isize = 0x0008_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;

    const WS_EX_DLGMODALFRAME: isize = 0x0000_0001;
    const WS_EX_WINDOWEDGE: isize = 0x0000_0100;
    const WS_EX_CLIENTEDGE: isize = 0x0000_0200;
    const WS_EX_STATICEDGE: isize = 0x0002_0000;

    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    let Ok(hwnd) = window.hwnd() else { return; };
    let raw_hwnd = hwnd.0 as *mut c_void;

    unsafe {
        let style = GetWindowLongPtrW(raw_hwnd, GWL_STYLE);
        let stripped_style = style
            & !(WS_CAPTION
                | WS_THICKFRAME
                | WS_SYSMENU
                | WS_MINIMIZEBOX
                | WS_MAXIMIZEBOX);
        if stripped_style != style {
            let _ = SetWindowLongPtrW(raw_hwnd, GWL_STYLE, stripped_style);
        }

        let ex_style = GetWindowLongPtrW(raw_hwnd, GWL_EXSTYLE);
        let stripped_ex_style = ex_style
            & !(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
        if stripped_ex_style != ex_style {
            let _ = SetWindowLongPtrW(raw_hwnd, GWL_EXSTYLE, stripped_ex_style);
        }

        // Make Windows recalculate the non-client area immediately after the
        // style change. No geometry is changed here.
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

    const DWMWA_NCRENDERING_POLICY: i32 = 2;
    const DWMWA_ALLOW_NCPAINT: i32 = 4;
    const DWMWA_WINDOW_CORNER_PREFERENCE: i32 = 33;
    const DWMWA_BORDER_COLOR: i32 = 34;

    const DWMNCRP_DISABLED: u32 = 1;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
    const FALSE_VALUE: u32 = 0;

    if let Ok(hwnd) = window.hwnd() {
        let raw_hwnd = hwnd.0 as *mut c_void;
        unsafe {
            // Dayforge paints all chrome itself. Disable DWM non-client
            // rendering so a transparent WebView cannot resurrect the native
            // caption/title buttons during focus or compositor changes.
            let _ = DwmSetWindowAttribute(
                raw_hwnd,
                DWMWA_NCRENDERING_POLICY,
                &DWMNCRP_DISABLED as *const u32 as *const c_void,
                size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                raw_hwnd,
                DWMWA_ALLOW_NCPAINT,
                &FALSE_VALUE as *const u32 as *const c_void,
                size_of::<u32>() as u32,
            );
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

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

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
        fn GetWindowRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else { return; };
    let Ok(scale) = window.scale_factor() else { return; };
    let raw_hwnd = hwnd.0 as *mut c_void;

    let mut rect = Rect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };

    if unsafe { GetWindowRect(raw_hwnd, &mut rect) } == 0 {
        return;
    }

    // SetWindowRgn clips the whole HWND, so use the whole HWND's physical
    // dimensions too. Mixing inner_size() with a top-level HWND was the source
    // of the old square Acrylic gutter when Windows briefly restored NC chrome.
    let width = (rect.right - rect.left).max(1);
    let height = (rect.bottom - rect.top).max(1);
    let logical_width = width as f64 / scale;
    let radius_logical = if logical_width <= 320.0 {
        24.0
    } else if logical_width >= 980.0 {
        26.0
    } else {
        24.0 + 2.0 * ((logical_width - 320.0) / (980.0 - 320.0))
    };
    let ellipse = (radius_logical * 2.0 * scale).round().max(1.0) as i32;

    unsafe {
        let region = CreateRoundRectRgn(0, 0, width + 1, height + 1, ellipse, ellipse);
        if region.is_null() {
            return;
        }

        // Windows owns the HRGN after a successful SetWindowRgn call.
        if SetWindowRgn(raw_hwnd, region, 1) == 0 {
            let _ = DeleteObject(region);
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_native_frost(window: &tauri::WebviewWindow) {
    use std::{
        ffi::c_void,
        mem::{size_of, transmute},
    };

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

    // Some Windows SDK import libraries do not export this undocumented API,
    // so resolve it at runtime instead of introducing a release-link failure.
    let user32_name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
    let module = unsafe { GetModuleHandleW(user32_name.as_ptr()) };
    if module.is_null() {
        return;
    }

    let proc = unsafe { GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr()) };
    if proc.is_null() {
        return;
    }

    let set_window_composition_attribute: SetWindowCompositionAttributeFn =
        unsafe { transmute(proc) };

    // AccentPolicy color is AABBGGRR. Keep it neutral and lightly milky; this
    // is the only layer that actually blurs the desktop behind Dayforge.
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

    let acrylic_result =
        unsafe { set_window_composition_attribute(hwnd.0 as *mut c_void, &mut acrylic_data) };

    if acrylic_result == 0 {
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
            let _ = set_window_composition_attribute(hwnd.0 as *mut c_void, &mut blur_data);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn strip_native_non_client_frame(_window: &tauri::WebviewWindow) {}

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
                strip_native_non_client_frame(&window);
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
            {
                if matches!(event, WindowEvent::Focused(_) | WindowEvent::ScaleFactorChanged { .. }) {
                    if let Some(webview_window) = window.app_handle().get_webview_window("main") {
                        strip_native_non_client_frame(&webview_window);
                        suppress_native_window_frame(&webview_window);
                    }
                }

                if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                    if let Some(webview_window) = window.app_handle().get_webview_window("main") {
                        clip_native_window_to_glass(&webview_window);
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
