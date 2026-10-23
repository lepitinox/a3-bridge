//! A3 Bridge: Arma 3 extension exposing the running scenario on a local HTTP + WebSocket gateway.
//!
//! The game calls the `RVExtension*` exports through `callExtension`; everything else
//! (network threads, command queue, state cache) lives in [`bridge::Bridge`].

mod bridge;
mod catalog;
mod log;
mod map;
mod net;
mod settings;
mod spec;
mod sqf;

use std::ffi::{c_char, c_int, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};

pub const VERSION: &str = concat!("a3_bridge ", env!("CARGO_PKG_VERSION"));

/// Copies `text` into the engine's buffer, truncated on a character boundary, NUL-terminated.
unsafe fn write_output(output: *mut c_char, size: c_int, text: &str) {
    if output.is_null() || size <= 0 {
        return;
    }
    let mut n = text.len().min(size as usize - 1);
    while !text.is_char_boundary(n) {
        n -= 1;
    }
    std::ptr::copy_nonoverlapping(text.as_ptr(), output as *mut u8, n);
    *output.add(n) = 0;
}

unsafe fn c_string(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

#[no_mangle]
pub unsafe extern "system" fn RVExtensionVersion(output: *mut c_char, output_size: c_int) {
    write_output(output, output_size, VERSION);
}

#[no_mangle]
pub unsafe extern "system" fn RVExtension(output: *mut c_char, output_size: c_int, function: *const c_char) {
    let function = c_string(function);
    let size = output_size.max(0) as usize;
    let text = catch_unwind(|| bridge::call(&function, &[], size)).map(|(t, _)| t).unwrap_or_default();
    write_output(output, output_size, &text);
}

#[no_mangle]
pub unsafe extern "system" fn RVExtensionArgs(
    output: *mut c_char,
    output_size: c_int,
    function: *const c_char,
    argv: *const *const c_char,
    argc: c_int,
) -> c_int {
    let function = c_string(function);
    let args: Vec<Vec<u8>> = (0..argc.max(0) as usize)
        .map(|i| {
            let p = if argv.is_null() { std::ptr::null() } else { *argv.add(i) };
            if p.is_null() { Vec::new() } else { CStr::from_ptr(p).to_bytes().to_vec() }
        })
        .collect();
    let size = output_size.max(0) as usize;
    match catch_unwind(AssertUnwindSafe(|| bridge::call(&function, &args, size))) {
        Ok((text, code)) => {
            write_output(output, output_size, &text);
            code
        }
        Err(_) => {
            log::write(format!("panic while handling '{function}'"));
            write_output(output, output_size, "");
            -1
        }
    }
}
