//! How long it has been since the last keyboard or mouse input, anywhere on the system
//! (not just in this window). The timer uses it to stop counting when nobody is working.
//!
//! macOS: `CGEventSourceSecondsSinceLastEventType`. It needs no permission (no
//! Accessibility or Input Monitoring prompt) because it reports only an elapsed time,
//! never what was typed. Other systems return `None` and the timer simply doesn't
//! auto-pause there.

#[cfg(target_os = "macos")]
pub fn seconds() -> Option<f64> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0; // kCGEventSourceStateCombinedSessionState
    const ANY_INPUT_EVENT: u32 = u32::MAX; // kCGAnyInputEventType

    // SAFETY: a plain function of two integers with no pointers and no shared state.
    let secs = unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
    (secs.is_finite() && secs >= 0.0).then_some(secs)
}

#[cfg(not(target_os = "macos"))]
pub fn seconds() -> Option<f64> {
    None
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_system_idle_time() {
        let first = super::seconds().expect("idle time is available on macOS");
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let second = super::seconds().expect("idle time is available on macOS");
        // With no input in between it grows by the sleep; any input resets it towards 0.
        // Either way it is a sane, non-negative number and not an error value.
        assert!(first >= 0.0 && second >= 0.0);
        assert!(first < 1.0e7 && second < 1.0e7, "an implausibly large idle time: {first} / {second}");
        println!("idle: {first:.2}s then {second:.2}s");
    }
}
