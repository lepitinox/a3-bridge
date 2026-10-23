//! Conversions between JSON and SQF text.
//!
//! Towards the game we emit literals `parseSimpleArray` accepts (numbers, strings, booleans, arrays).
//! From the game we read the output of `str`, which is the same syntax plus bare words
//! such as `any` (nil) or object descriptions.

use serde_json::{Number, Value};

pub fn number(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{}", f)
    }
}

pub fn string(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Serialises a JSON value as an SQF literal; objects and null have no SQF equivalent.
pub fn value(v: &Value) -> Result<String, String> {
    match v {
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()).map(number).ok_or_else(|| "invalid number".into()),
        Value::String(s) => Ok(string(s)),
        Value::Bool(b) => Ok(b.to_string()),
        Value::Array(items) => Ok(format!("[{}]", items.iter().map(value).collect::<Result<Vec<_>, _>>()?.join(","))),
        Value::Null => Err("null is not allowed inside SQF arrays".into()),
        Value::Object(_) => Err("objects are not allowed inside SQF arrays; use lists".into()),
    }
}

/// Undoes the quoting the engine applies to string arguments of `callExtension`
/// ("abc""d" becomes abc"d). Works on bytes so chunks may split UTF-8 sequences.
pub fn unquote(arg: &[u8]) -> Vec<u8> {
    if arg.len() < 2 || arg[0] != b'"' || arg[arg.len() - 1] != b'"' {
        return arg.to_vec();
    }
    let inner = &arg[1..arg.len() - 1];
    let mut out = Vec::with_capacity(inner.len());
    let mut i = 0;
    while i < inner.len() {
        out.push(inner[i]);
        i += if inner[i] == b'"' && inner.get(i + 1) == Some(&b'"') { 2 } else { 1 };
    }
    out
}

pub fn json_number(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9e15 {
        Value::from(f as i64)
    } else {
        Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// Parses `str` output leniently: anything unexpected becomes a string rather than an error.
pub fn parse(text: &str) -> Value {
    let mut p = Parser { s: text.as_bytes(), i: 0 };
    p.value()
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.i += 1;
        }
    }

    fn value(&mut self) -> Value {
        self.skip_ws();
        match self.peek() {
            Some(b'[') => self.array(),
            Some(b'"') => self.string(),
            _ => self.bare(),
        }
    }

    fn array(&mut self) -> Value {
        self.i += 1;
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            match self.peek() {
                None => break,
                Some(b']') => {
                    self.i += 1;
                    break;
                }
                Some(b',') => self.i += 1,
                _ => items.push(self.value()),
            }
        }
        Value::Array(items)
    }

    fn string(&mut self) -> Value {
        self.i += 1;
        let mut out = Vec::new();
        while let Some(c) = self.peek() {
            self.i += 1;
            if c == b'"' {
                if self.peek() == Some(b'"') {
                    self.i += 1;
                } else {
                    break;
                }
            }
            out.push(c);
        }
        Value::String(String::from_utf8_lossy(&out).into_owned())
    }

    fn bare(&mut self) -> Value {
        let start = self.i;
        let mut depth = 0i32;
        while let Some(c) = self.peek() {
            match c {
                b'(' => depth += 1,
                b')' => depth -= 1,
                b',' | b']' if depth <= 0 => break,
                _ => {}
            }
            self.i += 1;
        }
        if self.i == start && self.peek().is_some() {
            self.i += 1; // stray character; skip it so parsing always progresses
        }
        let word = String::from_utf8_lossy(&self.s[start..self.i]).trim().to_string();
        match word.as_str() {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            "" | "any" | "nil" | "<null>" => Value::Null,
            _ => match word.parse::<f64>() {
                Ok(f) if f.is_finite() => json_number(f),
                _ => Value::String(word),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_str_output() {
        let v = parse(r#"[["Stratis","a ""quoted"" name",12.5,1e+006,true,[1,2,3]],[],any,B Alpha 1-1:1 (Player)]"#);
        assert_eq!(v, json!([["Stratis", "a \"quoted\" name", 12.5, 1000000, true, [1, 2, 3]], [], null, "B Alpha 1-1:1 (Player)"]));
    }

    #[test]
    fn round_trips_literals() {
        let v = json!(["x\"y", 3, 2.5, false, [1, [2]]]);
        assert_eq!(value(&v).unwrap(), r#"["x""y",3,2.5,false,[1,[2]]]"#);
        assert_eq!(parse(&value(&v).unwrap()), v);
    }

    #[test]
    fn unquotes_engine_arguments() {
        assert_eq!(unquote(br#""a""b""#), br#"a"b"#);
        assert_eq!(unquote(b"25"), b"25");
        assert_eq!(unquote(br#""""""#), br#"""#);
    }
}
