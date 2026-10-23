//! Catalog of what can be placed (classes, groups, marker types and colours), read from the game's
//! configs by fn_exportCatalog.sqf once per game process and served at GET /catalog.

use crate::spec::Spec;
use crate::{log, sqf};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
pub struct CatalogStore {
    building: Option<HashMap<String, Vec<Value>>>,
    ready: Option<Arc<str>>,
    counts: Map<String, Value>,
}

impl CatalogStore {
    /// True when the game must read the catalog: not done yet in this process and not under way.
    pub fn needed(&self) -> bool {
        self.ready.is_none() && self.building.is_none()
    }

    pub fn begin(&mut self) {
        self.building = Some(HashMap::new());
    }

    pub fn add(&mut self, section: &str, text: &str) {
        if let (Some(b), Value::Array(rows)) = (self.building.as_mut(), sqf::parse(text)) {
            b.entry(section.to_string()).or_default().extend(rows);
        }
    }

    pub fn commit(&mut self, spec: &Spec) {
        let Some(mut built) = self.building.take() else { return };
        let mut sections = Map::new();
        self.counts = Map::new();
        for s in &spec.catalog {
            let rows = built.remove(&s.name).unwrap_or_default();
            self.counts.insert(s.name.clone(), rows.len().into());
            sections.insert(s.name.clone(), json!({"description": s.description, "fields": s.fields, "rows": rows}));
        }
        let generated = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let text: Arc<str> = json!({"generated_at": generated, "sections": sections}).to_string().into();
        log::write(format!("catalog ready ({} KB): {}", text.len() / 1024, Value::Object(self.counts.clone())));
        self.ready = Some(text);
    }

    pub fn get(&self) -> Option<Arc<str>> {
        self.ready.clone()
    }

    pub fn status_json(&self) -> Value {
        json!({"ready": self.ready.is_some(), "building": self.building.is_some(), "counts": self.counts})
    }
}
