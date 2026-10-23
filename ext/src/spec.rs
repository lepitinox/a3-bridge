//! The protocol description generated from the design tables (build/spec.json),
//! used to validate commands and to name the values the game sends back.

use crate::sqf;
use serde_json::{json, Map, Value};

pub const SPEC_JSON: &str = include_str!("../../build/spec.json");
pub const TOOLS_JSON: &str = include_str!("../../build/tools.json");
pub const UI_HTML: &str = include_str!("../../src/ui/index.html");

#[derive(Debug)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
}

impl BridgeError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        BridgeError { code, message: message.into() }
    }

    pub fn to_json(&self) -> Value {
        json!({"ok": false, "error": {"code": self.code, "message": self.message}})
    }
}

pub enum Kind {
    Number,
    String,
    Boolean,
    Position,
    Array,
    Enum,
}

pub struct Param {
    pub name: String,
    pub kind: Kind,
    pub required: bool,
    pub default: Value,
    pub values: Vec<String>,
    pub range: Option<(f64, f64)>,
}

pub struct Command {
    pub name: String,
    pub returns: Vec<String>,
    pub params: Vec<Param>,
}

pub struct Entity {
    pub name: String,
    pub multiple: bool,
    pub fields: Vec<String>,
}

pub struct Event {
    pub name: String,
    pub fields: Vec<String>,
}

pub struct Setting {
    pub key: String,
    pub default: Value,
    pub to_sqf: bool,
}

pub struct CatalogSection {
    pub name: String,
    pub description: String,
    pub fields: Vec<String>,
}

pub struct Spec {
    pub catalog: Vec<CatalogSection>,
    pub commands: Vec<Command>,
    pub entities: Vec<Entity>,
    pub events: Vec<Event>,
    pub settings: Vec<Setting>,
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

impl Spec {
    pub fn load() -> Spec {
        let root: Value = serde_json::from_str(SPEC_JSON).expect("embedded spec.json is valid");
        let types = &root["types"];
        let commands = root["commands"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| Command {
                name: text(&c["name"]),
                returns: strings(&c["returns"]),
                params: c["params"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|p| {
                        let ty = &types[p["type"].as_str().unwrap_or_default()];
                        Param {
                            name: text(&p["name"]),
                            kind: match p["kind"].as_str().unwrap_or_default() {
                                "number" => Kind::Number,
                                "boolean" => Kind::Boolean,
                                "position" => Kind::Position,
                                "array" => Kind::Array,
                                "enum" => Kind::Enum,
                                _ => Kind::String,
                            },
                            required: p["required"].as_bool().unwrap_or(false),
                            default: p["default"].clone(),
                            values: strings(&ty["values"]),
                            range: ty["range"].as_array().and_then(|r| Some((r.first()?.as_f64()?, r.get(1)?.as_f64()?))),
                        }
                    })
                    .collect(),
            })
            .collect();
        let entities = root["entities"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| Entity { name: text(&e["name"]), multiple: e["multiple"].as_bool().unwrap_or(true), fields: strings(&e["fields"]) })
            .collect();
        let events = root["events"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| Event { name: text(&e["name"]), fields: strings(&e["fields"]) })
            .collect();
        let settings = root["settings"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| Setting { key: text(&s["key"]), default: s["default"].clone(), to_sqf: s["to_sqf"].as_bool().unwrap_or(false) })
            .collect();
        let catalog = root["catalog"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| CatalogSection { name: text(&s["name"]), description: text(&s["description"]), fields: strings(&s["fields"]) })
            .collect();
        Spec { catalog, commands, entities, events, settings }
    }

    pub fn command_names(&self) -> Vec<&str> {
        self.commands.iter().map(|c| c.name.as_str()).collect()
    }

    /// Validates a command and returns its index and its positional arguments as an SQF array.
    pub fn build_call(&self, name: &str, args: &Value) -> Result<(usize, String), BridgeError> {
        let (idx, cmd) = self.commands.iter().enumerate().find(|(_, c)| c.name == name).ok_or_else(|| {
            BridgeError::new("unknown_command", format!("unknown command '{name}'; valid commands: {}", self.command_names().join(", ")))
        })?;
        let empty = Map::new();
        let given = match args {
            Value::Null => &empty,
            Value::Object(m) => m,
            _ => return Err(BridgeError::new("invalid_args", "args must be a JSON object")),
        };
        let valid = || cmd.params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ");
        if let Some(unknown) = given.keys().find(|k| !cmd.params.iter().any(|p| &p.name == *k)) {
            return Err(BridgeError::new("invalid_args", format!("unknown parameter '{unknown}' for {name}; valid parameters: {}", valid())));
        }
        let mut parts = Vec::with_capacity(cmd.params.len());
        for p in &cmd.params {
            let v = match given.get(&p.name) {
                Some(v) if !v.is_null() => v,
                _ if p.required => return Err(BridgeError::new("invalid_args", format!("missing required parameter '{}' for {name}", p.name))),
                _ => &p.default,
            };
            parts.push(p.to_sqf(v).map_err(|m| BridgeError::new("invalid_args", format!("parameter '{}': {m}", p.name)))?);
        }
        Ok((idx, format!("[{}]", parts.join(","))))
    }
}

impl Param {
    fn to_sqf(&self, v: &Value) -> Result<String, String> {
        match self.kind {
            Kind::Number => {
                let f = v.as_f64().filter(|f| f.is_finite()).ok_or("expected a number")?;
                if let Some((lo, hi)) = self.range {
                    if f < lo || f > hi {
                        return Err(format!("{f} is outside {lo}..{hi}"));
                    }
                }
                Ok(sqf::number(f))
            }
            Kind::String => v.as_str().map(sqf::string).ok_or_else(|| "expected a string".into()),
            Kind::Boolean => v.as_bool().map(|b| b.to_string()).ok_or_else(|| "expected true or false".into()),
            Kind::Position => {
                let nums: Vec<f64> = v
                    .as_array()
                    .filter(|a| a.len() == 2 || a.len() == 3)
                    .and_then(|a| a.iter().map(|x| x.as_f64().filter(|f| f.is_finite())).collect())
                    .ok_or("expected [x, y] or [x, y, z] numbers")?;
                let z = nums.get(2).copied().unwrap_or(0.0);
                Ok(format!("[{},{},{}]", sqf::number(nums[0]), sqf::number(nums[1]), sqf::number(z)))
            }
            Kind::Array => {
                if !v.is_array() {
                    return Err("expected a list".into());
                }
                sqf::value(v)
            }
            Kind::Enum => {
                let s = v.as_str().map(str::to_lowercase).ok_or("expected a string")?;
                if self.values.contains(&s) {
                    Ok(sqf::string(&s))
                } else {
                    Err(format!("'{s}' is not one of {}", self.values.join(", ")))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_spawn_unit_with_defaults() {
        let spec = Spec::load();
        let (_, sqf) = spec.build_call("spawn_unit", &json!({"type": "B_Soldier_F", "pos": [100, 200]})).unwrap();
        assert_eq!(sqf, r#"["B_Soldier_F",[100,200,0],"west","none",0,0.5]"#);
    }

    #[test]
    fn rejects_bad_arguments() {
        let spec = Spec::load();
        assert_eq!(spec.build_call("nope", &json!({})).unwrap_err().code, "unknown_command");
        assert_eq!(spec.build_call("spawn_unit", &json!({"pos": [1, 2]})).unwrap_err().code, "invalid_args");
        assert_eq!(spec.build_call("set_health", &json!({"id": "u1", "health": 2})).unwrap_err().code, "invalid_args");
        assert_eq!(spec.build_call("message", &json!({"text": "hi", "kind": "shout"})).unwrap_err().code, "invalid_args");
        assert_eq!(spec.build_call("move", &json!({"id": "u1", "pos": [1, 2], "speed": 3})).unwrap_err().code, "invalid_args");
    }
}
