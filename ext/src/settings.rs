//! Settings: defaults from the design table, optionally overridden by `a3_bridge.json`
//! placed next to the DLL.

use crate::{log, spec::Spec, sqf};
use serde_json::{Map, Value};
use std::ffi::c_void;
use std::path::PathBuf;

pub struct Settings {
    values: Map<String, Value>,
    to_sqf: Vec<String>,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleExW(flags: u32, name: *const u16, module: *mut *mut c_void) -> i32;
    fn GetModuleFileNameW(module: *mut c_void, filename: *mut u16, size: u32) -> u32;
}

/// Folder containing this DLL (the mod folder), found from the address of one of our functions.
pub fn dll_dir() -> Option<PathBuf> {
    const FROM_ADDRESS: u32 = 0x4;
    const UNCHANGED_REFCOUNT: u32 = 0x2;
    unsafe {
        let mut module = std::ptr::null_mut();
        let anchor = dll_dir as *const () as *const u16;
        if GetModuleHandleExW(FROM_ADDRESS | UNCHANGED_REFCOUNT, anchor, &mut module) == 0 {
            return None;
        }
        let mut buf = vec![0u16; 1024];
        let n = GetModuleFileNameW(module, buf.as_mut_ptr(), buf.len() as u32) as usize;
        if n == 0 {
            return None;
        }
        PathBuf::from(String::from_utf16_lossy(&buf[..n])).parent().map(PathBuf::from)
    }
}

impl Settings {
    pub fn load(spec: &Spec) -> Settings {
        let mut values = Map::new();
        for s in &spec.settings {
            values.insert(s.key.clone(), s.default.clone());
        }
        let to_sqf = spec.settings.iter().filter(|s| s.to_sqf).map(|s| s.key.clone()).collect();
        let mut settings = Settings { values, to_sqf };
        if let Some(path) = dll_dir().map(|d| d.join("a3_bridge.json")).filter(|p| p.is_file()) {
            settings.apply_file(&path);
        }
        settings
    }

    fn apply_file(&mut self, path: &PathBuf) {
        let parsed = std::fs::read_to_string(path).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|e| e.to_string()));
        let Ok(Value::Object(overrides)) = parsed else {
            log::write(format!("ignoring {}: not a valid JSON object", path.display()));
            return;
        };
        for (k, v) in overrides {
            match self.values.get(&k) {
                Some(old) if old.is_number() == v.is_number() && old.is_boolean() == v.is_boolean() => {
                    log::write(format!("setting {k} = {v} (from {})", path.display()));
                    self.values.insert(k, v);
                }
                Some(_) => log::write(format!("ignoring setting {k}: wrong type")),
                None => log::write(format!("ignoring unknown setting {k}")),
            }
        }
    }

    pub fn num(&self, key: &str) -> f64 {
        self.values.get(key).and_then(Value::as_f64).unwrap_or(0.0)
    }

    pub fn flag(&self, key: &str) -> bool {
        self.values.get(key).and_then(Value::as_bool).unwrap_or(false)
    }

    /// Values the SQF side needs, in table order, as an SQF array.
    pub fn sqf_array(&self) -> String {
        let parts: Vec<String> = self.to_sqf.iter().map(|k| sqf::value(&self.values[k]).unwrap_or_else(|_| "0".into())).collect();
        format!("[{}]", parts.join(","))
    }

    pub fn as_json(&self) -> Value {
        Value::Object(self.values.clone())
    }
}
