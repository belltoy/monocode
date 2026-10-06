//! Native font selection. Keep platform objects on the UI thread and return
//! only the selected family; terminal size remains a separate preference.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;

static PICKER_OPEN: AtomicBool = AtomicBool::new(false);

struct PickerGuard;

impl Drop for PickerGuard {
    fn drop(&mut self) {
        PICKER_OPEN.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn pick_terminal_font(
    window: WebviewWindow,
    family: String,
    size: f64,
) -> Result<Option<String>, String> {
    if !size.is_finite() || !(10.0..=24.0).contains(&size) {
        return Err("Invalid terminal font size".into());
    }
    if PICKER_OPEN.swap(true, Ordering::AcqRel) {
        return Err("A font picker is already open".into());
    }
    let guard = PickerGuard;
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let _guard = guard;
            let result = platform::pick(&owner, &family, size);
            let _ = tx.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv()
        .await
        .ok_or_else(|| "Font picker closed without a response".to_string())?
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSBezelStyle, NSButton, NSFont, NSFontManager, NSFontPanel, NSFontTraitMask,
        NSModalResponseCancel, NSModalResponseOK, NSView, NSWindow, NSWindowDelegate,
    };
    use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
    use std::cell::RefCell;
    use tauri::WebviewWindow;

    struct FontPickerIvars {
        font: RefCell<Retained<NSFont>>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MonoCodeFontPickerTarget"]
        #[ivars = FontPickerIvars]
        struct FontPickerTarget;

        impl FontPickerTarget {
            #[unsafe(method(changeFont:))]
            fn change_font(&self, _sender: Option<&AnyObject>) {
                let panel = NSFontPanel::sharedFontPanel(self.mtm());
                let next = panel.panelConvertFont(&self.ivars().font.borrow());
                *self.ivars().font.borrow_mut() = next;
            }

            #[unsafe(method(choose:))]
            fn choose(&self, _sender: Option<&AnyObject>) {
                NSApplication::sharedApplication(self.mtm()).stopModalWithCode(NSModalResponseOK);
            }

            #[unsafe(method(cancel:))]
            fn cancel(&self, _sender: Option<&AnyObject>) {
                NSApplication::sharedApplication(self.mtm()).stopModalWithCode(NSModalResponseCancel);
            }
        }

        unsafe impl NSObjectProtocol for FontPickerTarget {}

        unsafe impl NSWindowDelegate for FontPickerTarget {
            #[unsafe(method(windowShouldClose:))]
            fn window_should_close(&self, _sender: &NSWindow) -> bool {
                NSApplication::sharedApplication(self.mtm()).stopModalWithCode(NSModalResponseCancel);
                false
            }
        }
    );

    pub fn pick(window: &WebviewWindow, family: &str, size: f64) -> Result<Option<String>, String> {
        let mtm = MainThreadMarker::new().ok_or("Font picker requires the main thread")?;
        let manager = NSFontManager::sharedFontManager(mtm);
        let font = manager
            .fontWithFamily_traits_weight_size(
                &NSString::from_str(family.trim()),
                NSFontTraitMask(0),
                5,
                size,
            )
            .or_else(|| NSFont::userFixedPitchFontOfSize(size))
            .ok_or("Could not resolve the terminal font")?;
        let target = FontPickerTarget::alloc(mtm).set_ivars(FontPickerIvars {
            font: RefCell::new(font.clone()),
        });
        let target: Retained<FontPickerTarget> = unsafe { msg_send![super(target), init] };
        let panel = NSFontPanel::sharedFontPanel(mtm);
        let old_delegate = panel.delegate();
        let old_accessory = panel.accessoryView();
        let old_target = manager.target();
        let old_action = manager.action();
        let accessory = NSView::initWithFrame(
            NSView::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(260.0, 44.0)),
        );
        // NSFontPanel is the system Fonts UI; these accessory buttons give it
        // explicit commit/cancel semantics without changing settings on preview.
        for (title, action, x) in [
            ("Cancel", sel!(cancel:), 60.0),
            ("Choose", sel!(choose:), 160.0),
        ] {
            let button = unsafe {
                NSButton::buttonWithTitle_target_action(
                    &NSString::from_str(title),
                    Some(&target),
                    Some(action),
                    mtm,
                )
            };
            button.setFrame(NSRect::new(NSPoint::new(x, 8.0), NSSize::new(90.0, 28.0)));
            button.setBezelStyle(NSBezelStyle::Push);
            button.setKeyEquivalent(&NSString::from_str(if title == "Choose" {
                "\r"
            } else {
                "\u{1b}"
            }));
            accessory.addSubview(&button);
        }
        unsafe {
            manager.setTarget(Some(&target));
            manager.setAction(sel!(changeFont:));
        }
        manager.setSelectedFont_isMultiple(&font, false);
        panel.setPanelFont_isMultiple(&font, false);
        panel.setAccessoryView(Some(&accessory));
        panel.setDelegate(Some(ProtocolObject::from_ref(&*target)));
        panel.setWorksWhenModal(true);
        panel.center();
        let response = NSApplication::sharedApplication(mtm).runModalForWindow(&panel);
        // The panel is authoritative. Font-manager action delivery can be
        // skipped in a modal session, leaving the callback's cached font stale.
        // Read the current selection before hiding/restoring the shared panel.
        let selected_family = if response == NSModalResponseOK {
            panel
                .panelConvertFont(&font)
                .familyName()
                .map(|name| name.to_string())
        } else {
            None
        };
        panel.orderOut(None);
        panel.setDelegate(old_delegate.as_deref());
        panel.setAccessoryView(old_accessory.as_deref());
        unsafe {
            manager.setTarget(old_target.as_deref());
            manager.setAction(old_action);
        }
        let _ = window.set_focus();
        Ok(selected_family)
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use tauri::WebviewWindow;
    use windows_sys::Win32::Graphics::Gdi::LOGFONTW;
    use windows_sys::Win32::UI::Controls::Dialogs::{
        ChooseFontW, CommDlgExtendedError, CF_INITTOLOGFONTSTRUCT, CF_SCREENFONTS, CHOOSEFONTW,
    };

    pub fn pick(window: &WebviewWindow, family: &str, size: f64) -> Result<Option<String>, String> {
        // Win32 common dialogs expect zero-initialized C structures.
        let mut font: LOGFONTW = unsafe { std::mem::zeroed() };
        font.lfHeight = -(size.round() as i32);
        for (slot, unit) in font
            .lfFaceName
            .iter_mut()
            .take(31)
            .zip(family.encode_utf16())
        {
            *slot = unit;
        }
        let mut dialog: CHOOSEFONTW = unsafe { std::mem::zeroed() };
        dialog.lStructSize = std::mem::size_of::<CHOOSEFONTW>() as u32;
        dialog.hwndOwner = window.hwnd().map_err(|error| error.to_string())?.0 as _;
        dialog.lpLogFont = &mut font;
        dialog.Flags = CF_SCREENFONTS | CF_INITTOLOGFONTSTRUCT;
        if unsafe { ChooseFontW(&mut dialog) } != 0 {
            let length = font
                .lfFaceName
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(32);
            Ok(Some(String::from_utf16_lossy(&font.lfFaceName[..length])))
        } else {
            let error = unsafe { CommDlgExtendedError() };
            if error == 0 {
                Ok(None)
            } else {
                Err(format!("Font picker failed: {error}"))
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use gtk::prelude::*;
    use tauri::WebviewWindow;

    pub fn pick(window: &WebviewWindow, family: &str, size: f64) -> Result<Option<String>, String> {
        let owner = window.gtk_window().map_err(|error| error.to_string())?;
        let dialog = gtk::FontChooserDialog::new(Some("Terminal Font Family"), Some(&owner));
        dialog.set_modal(true);
        let family = if family.trim().is_empty() {
            "Monospace"
        } else {
            family
        };
        dialog.set_font(&format!("{family} {size}"));
        let response = dialog.run();
        let family = if response == gtk::ResponseType::Ok {
            dialog
                .font_desc()
                .and_then(|font| font.family())
                .map(|family| family.to_string())
        } else {
            None
        };
        dialog.close();
        Ok(family)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod platform {
    pub fn pick(_: &tauri::WebviewWindow, _: &str, _: f64) -> Result<Option<String>, String> {
        Err("Native font selection is not supported on this platform".into())
    }
}
