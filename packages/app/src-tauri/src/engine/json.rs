//! JSON as the PowerShell engine reads and writes it.
//!
//! The engine persists manifests with `ConvertTo-Json -Compress` and reads them back with
//! `ConvertFrom-Json`, both built on Newtonsoft.Json. Two things about that pair decide bytes on
//! disk, so this module copies them instead of using `serde_json`:
//! - key order is kept as written (`serde_json` here is built without `preserve_order`);
//! - strings are escaped the Newtonsoft way: `\b \f \n \r \t` short, every other control
//!   character and U+0085, U+2028, U+2029 as a lowercase `\u` escape, nothing else;
//! - a string that looks like an ISO 8601 timestamp is read as a date and written back in the
//!   round-trip form with trailing zeros of the fraction removed (probed on the test PC,
//!   2026-09-30: `2026-09-30T08:09:10.1230000Z` comes back as `2026-09-30T08:09:10.123Z`).

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

/// A JSON value with its object keys in document order. Numbers keep their literal text.
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn str(value: impl Into<String>) -> Self { Json::String(value.into()) }

    pub fn opt_str(value: Option<impl Into<String>>) -> Self {
        match value { Some(v) => Json::String(v.into()), None => Json::Null }
    }

    pub fn int(value: i64) -> Self { Json::Number(value.to_string()) }

    pub fn object(fields: Vec<(&str, Json)>) -> Self {
        Json::Object(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    /// The value of `key` (exact, case-sensitive), if this is an object that has it.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Sets `key`, replacing its value in place or appending it at the end.
    pub fn set(&mut self, key: &str, value: Json) {
        if let Json::Object(fields) = self {
            if let Some(slot) = fields.iter_mut().find(|(k, _)| k == key) { slot.1 = value; } else { fields.push((key.to_string(), value)); }
        }
    }

    pub fn as_str(&self) -> Option<&str> { if let Json::String(s) = self { Some(s) } else { None } }

    pub fn as_array(&self) -> Option<&Vec<Json>> { if let Json::Array(a) = self { Some(a) } else { None } }

    pub fn as_array_mut(&mut self) -> Option<&mut Vec<Json>> { if let Json::Array(a) = self { Some(a) } else { None } }

    pub fn is_null(&self) -> bool { matches!(self, Json::Null) }

    /// `ConvertTo-Json -Compress`.
    pub fn to_compact(&self) -> String {
        let mut out = String::new();
        write_value(self, &mut out);
        out
    }
}

fn write_value(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Number(n) => out.push_str(n),
        Json::String(s) => write_string(s, out),
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 { out.push(','); }
                write_value(item, out);
            }
            out.push(']');
        }
        Json::Object(fields) => {
            out.push('{');
            for (i, (key, item)) in fields.iter().enumerate() {
                if i > 0 { out.push(','); }
                write_string(key, out);
                out.push(':');
                write_value(item, out);
            }
            out.push('}');
        }
    }
}

/// A number as `ConvertFrom-Json` types it: Int64 when an integer fits, BigInteger when it does
/// not, Double for anything with a fraction or exponent (and NaN, Infinity).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Number { Int(i64), Big, Double(f64) }

impl Json {
    pub fn number(&self) -> Option<Number> {
        let Json::Number(text) = self else { return None };
        match text.as_str() {
            "NaN" => return Some(Number::Double(f64::NAN)),
            "Infinity" => return Some(Number::Double(f64::INFINITY)),
            "-Infinity" => return Some(Number::Double(f64::NEG_INFINITY)),
            _ => {}
        }
        if text.contains(['.', 'e', 'E']) { return text.parse::<f64>().ok().map(Number::Double); }
        Some(text.parse::<i64>().map(Number::Int).unwrap_or(Number::Big))
    }
}

/// How `ConvertTo-Json` (Newtonsoft) writes a double: .NET's `R` digits, with `.0` added when
/// the result has neither a decimal point nor an exponent.
pub fn newtonsoft_double(value: f64) -> String {
    let text = super::text::double_r(value);
    if value.is_finite() && !text.contains(['.', 'E', 'e']) { format!("{text}.0") } else { text }
}

/// A JSON string literal with Newtonsoft's default escaping.
pub fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{85}' || c == '\u{2028}' || c == '\u{2029}' => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// How strings are read. `Dates` is `ConvertFrom-Json`'s default: an ISO timestamp becomes a
/// date and is later written back in its round-trip form. `Literal` keeps every string as it is
/// (`-DateKind String`, and every parser that is not `ConvertFrom-Json`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strings { Dates, Literal }

/// How repeated object keys are treated. `ConvertFrom-Json` builds a PSCustomObject and refuses
/// keys that differ only in letter case; `-AsHashtable` keeps both; in both an exact repeat
/// replaces the earlier value in place. The Profile store (`ConvertFrom-KvkProfileElement`)
/// refuses an exact repeat and keeps case variants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Keys { RefuseCaseVariants, KeepCaseVariants, RefuseDuplicates }

/// The duplicate-key refusal of [`Keys::RefuseDuplicates`], told apart from a syntax error.
pub const DUPLICATE_KEY: &str = "duplicate key";

/// Which parser is being copied. `Newtonsoft` is `ConvertFrom-Json`: comments, trailing commas,
/// single quotes, bare property names, `NaN`/`Infinity`/`undefined`, hex and octal integers, any
/// Unicode whitespace, raw control characters inside strings (probed on the test PC,
/// 2026-09-30). `Strict` is System.Text.Json's `JsonDocument` defaults, which the Profile store
/// uses: RFC 8259 and nothing more.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grammar { Newtonsoft, Strict }

#[derive(Clone, Copy, Debug)]
pub struct ReadOptions { pub strings: Strings, pub keys: Keys, pub max_depth: usize }

impl ReadOptions {
    /// `ConvertFrom-Json` with no switches.
    pub const CONVERT_FROM_JSON: ReadOptions = ReadOptions { strings: Strings::Dates, keys: Keys::RefuseCaseVariants, max_depth: 64 };
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError(pub String);

/// Parses one JSON document the way `ConvertFrom-Json` does.
pub fn parse(text: &str, options: ReadOptions) -> Result<Json, ParseError> { parse_with(text, options, Grammar::Newtonsoft) }

/// Parses one JSON document with the given grammar.
pub fn parse_with(text: &str, options: ReadOptions, grammar: Grammar) -> Result<Json, ParseError> {
    let mut parser = Parser { chars: text.chars().collect(), pos: 0, options, grammar, depth: 0 };
    parser.skip_ws()?;
    if parser.pos >= parser.chars.len() {
        return if grammar == Grammar::Strict { Err(parser.error("The input does not contain any JSON tokens")) } else { Ok(Json::Null) };
    }
    let value = parser.value()?;
    parser.skip_ws()?;
    if parser.pos < parser.chars.len() { return Err(parser.error("Additional text encountered after finished reading JSON content")); }
    Ok(value)
}

struct Parser { chars: Vec<char>, pos: usize, options: ReadOptions, grammar: Grammar, depth: usize }

impl Parser {
    fn error(&self, what: &str) -> ParseError { ParseError(format!("{what} at position {}", self.pos)) }

    fn lenient(&self) -> bool { self.grammar == Grammar::Newtonsoft }

    fn peek(&self) -> Option<char> { self.chars.get(self.pos).copied() }

    fn peek_at(&self, offset: usize) -> Option<char> { self.chars.get(self.pos + offset).copied() }

    /// Whitespace, and in the Newtonsoft grammar any Unicode whitespace and comments.
    fn skip_ws(&mut self) -> Result<(), ParseError> {
        loop {
            match self.peek() {
                Some(' ' | '\t' | '\n' | '\r') => self.pos += 1,
                Some(c) if self.lenient() && c.is_whitespace() => self.pos += 1,
                Some('/') if self.lenient() && self.peek_at(1) == Some('*') => {
                    self.pos += 2;
                    loop {
                        match self.peek() {
                            None => return Err(self.error("Unexpected end while parsing comment")),
                            Some('*') if self.peek_at(1) == Some('/') => { self.pos += 2; break; }
                            Some(_) => self.pos += 1,
                        }
                    }
                }
                Some('/') if self.lenient() && self.peek_at(1) == Some('/') => {
                    while let Some(c) = self.peek() { if c == '\n' || c == '\r' { break; } self.pos += 1; }
                }
                _ => return Ok(()),
            }
        }
    }

    fn value(&mut self) -> Result<Json, ParseError> {
        self.skip_ws()?;
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"') => self.string_value(),
            Some('\'') if self.lenient() => self.string_value(),
            Some('t') => self.literal("true", Json::Bool(true)),
            Some('f') => self.literal("false", Json::Bool(false)),
            Some('n') => self.literal("null", Json::Null),
            Some('u') if self.lenient() => self.literal("undefined", Json::Null),
            Some('N') if self.lenient() => self.literal("NaN", Json::Number("NaN".into())),
            Some('I') if self.lenient() => self.literal("Infinity", Json::Number("Infinity".into())),
            Some('-') if self.lenient() && self.peek_at(1) == Some('I') => { self.pos += 1; self.literal("Infinity", Json::Number("-Infinity".into())) }
            Some(c) if c == '-' || c.is_ascii_digit() || (self.lenient() && c == '.') => self.number(),
            _ => Err(self.error("Unexpected character encountered while parsing value")),
        }
    }

    fn string_value(&mut self) -> Result<Json, ParseError> {
        let s = self.string()?;
        Ok(Json::String(if self.options.strings == Strings::Dates { round_trip_date(&s).unwrap_or(s) } else { s }))
    }

    fn enter(&mut self) -> Result<(), ParseError> {
        self.depth += 1;
        if self.depth > self.options.max_depth { return Err(self.error("The reader's MaxDepth has been exceeded")); }
        Ok(())
    }

    fn property_name(&mut self) -> Result<String, ParseError> {
        match self.peek() {
            Some('"') => self.string(),
            Some('\'') if self.lenient() => self.string(),
            Some(c) if self.lenient() && (c.is_alphanumeric() || c == '_' || c == '$') => {
                let start = self.pos;
                while self.peek().is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$') { self.pos += 1; }
                Ok(self.chars[start..self.pos].iter().collect())
            }
            _ => Err(self.error("Invalid property identifier character")),
        }
    }

    fn object(&mut self) -> Result<Json, ParseError> {
        self.enter()?;
        self.pos += 1;
        let mut fields: Vec<(String, Json)> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        let mut lowered: HashSet<String> = HashSet::new();
        loop {
            self.skip_ws()?;
            if self.peek() == Some('}') && (fields.is_empty() || self.lenient()) { self.pos += 1; self.depth -= 1; return Ok(Json::Object(fields)); }
            let key = self.property_name()?;
            self.skip_ws()?;
            if self.peek() != Some(':') { return Err(self.error("Invalid character after parsing property name")); }
            self.pos += 1;
            let value = self.value()?;
            if let Some(&at) = index.get(&key) {
                if self.options.keys == Keys::RefuseDuplicates { return Err(ParseError(DUPLICATE_KEY.to_string())); }
                if let Some(slot) = fields.get_mut(at) { slot.1 = value; }
            } else {
                let refuse = self.options.keys == Keys::RefuseCaseVariants;
                if refuse && lowered.contains(&key.to_lowercase()) {
                    return Err(ParseError(format!("keys with different casing: \"{key}\"")));
                }
                if refuse { lowered.insert(key.to_lowercase()); }
                index.insert(key.clone(), fields.len());
                fields.push((key, value));
            }
            self.skip_ws()?;
            match self.peek() {
                Some(',') => { self.pos += 1; }
                Some('}') => { self.pos += 1; self.depth -= 1; return Ok(Json::Object(fields)); }
                _ => return Err(self.error("After parsing a value an unexpected character was encountered")),
            }
        }
    }

    fn array(&mut self) -> Result<Json, ParseError> {
        self.enter()?;
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_ws()?;
            if self.peek() == Some(']') && (items.is_empty() || self.lenient()) { self.pos += 1; self.depth -= 1; return Ok(Json::Array(items)); }
            items.push(self.value()?);
            self.skip_ws()?;
            match self.peek() {
                Some(',') => { self.pos += 1; }
                Some(']') => { self.pos += 1; self.depth -= 1; return Ok(Json::Array(items)); }
                _ => return Err(self.error("After parsing a value an unexpected character was encountered")),
            }
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, ParseError> {
        let end = self.pos + word.chars().count();
        if end <= self.chars.len() && self.chars[self.pos..end].iter().copied().eq(word.chars()) {
            self.pos = end;
            Ok(value)
        } else {
            Err(self.error("Unexpected character encountered while parsing value"))
        }
    }

    fn number(&mut self) -> Result<Json, ParseError> {
        if !self.lenient() { return self.strict_number(); }
        // Newtonsoft reads a run of number characters, then decides: 0x… is hex, a leading zero
        // followed by more digits is octal, anything with '.', 'e' or 'E' is a double.
        let start = self.pos;
        while self.peek().is_some_and(|c| c.is_ascii_hexdigit() || matches!(c, '-' | '+' | '.' | 'x' | 'X')) { self.pos += 1; }
        let text: String = self.chars[start..self.pos].iter().collect();
        let (negative, body) = match text.strip_prefix('-') { Some(rest) => (true, rest), None => (false, text.as_str()) };
        let invalid = || ParseError(format!("Input string '{text}' is not a valid number"));
        let integer = |digits: &str, radix: u32| -> Result<Json, ParseError> {
            let magnitude = i128::from_str_radix(digits, radix).map_err(|_| invalid())?;
            Ok(Json::Number(if negative { (-magnitude).to_string() } else { magnitude.to_string() }))
        };
        if let Some(hex) = body.strip_prefix("0x").or_else(|| body.strip_prefix("0X")) { return integer(hex, 16); }
        if body.len() > 1 && body.starts_with('0') && body.bytes().all(|b| b.is_ascii_digit()) { return integer(&body[1..], 8); }
        let well_formed = {
            let b = body.as_bytes();
            let mut i = 0;
            while i < b.len() && b[i].is_ascii_digit() { i += 1; }
            let int_digits = i;
            let mut frac_digits = 0;
            if i < b.len() && b[i] == b'.' { i += 1; let f = i; while i < b.len() && b[i].is_ascii_digit() { i += 1; } frac_digits = i - f; }
            let mut ok = int_digits + frac_digits > 0;
            if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
                i += 1;
                if i < b.len() && (b[i] == b'+' || b[i] == b'-') { i += 1; }
                let e = i;
                while i < b.len() && b[i].is_ascii_digit() { i += 1; }
                ok &= i > e;
            }
            ok && i == b.len()
        };
        if !well_formed { return Err(invalid()); }
        Ok(Json::Number(text))
    }

    fn strict_number(&mut self) -> Result<Json, ParseError> {
        let start = self.pos;
        if self.peek() == Some('-') { self.pos += 1; }
        let digits = |p: &mut Parser| { let s = p.pos; while p.peek().is_some_and(|c| c.is_ascii_digit()) { p.pos += 1; } p.pos - s };
        let first = self.peek();
        let n = digits(self);
        if n == 0 || (n > 1 && first == Some('0')) { return Err(self.error("Invalid number")); }
        if self.peek() == Some('.') { self.pos += 1; if digits(self) == 0 { return Err(self.error("Invalid number")); } }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+' | '-')) { self.pos += 1; }
            if digits(self) == 0 { return Err(self.error("Invalid number")); }
        }
        Ok(Json::Number(self.chars[start..self.pos].iter().collect()))
    }

    fn string(&mut self) -> Result<String, ParseError> {
        let quote = self.peek().unwrap_or('"');
        self.pos += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            let Some(c) = self.peek() else { return Err(self.error("Unterminated string")) };
            self.pos += 1;
            match c {
                c if c == quote => break,
                '\\' => {
                    let Some(e) = self.peek() else { return Err(self.error("Unterminated string")) };
                    self.pos += 1;
                    match e {
                        '"' => units.push(0x22), '\\' => units.push(0x5c), '/' => units.push(0x2f),
                        '\'' if self.lenient() => units.push(0x27),
                        'b' => units.push(0x08), 'f' => units.push(0x0c), 'n' => units.push(0x0a),
                        'r' => units.push(0x0d), 't' => units.push(0x09),
                        'u' => {
                            let hex: String = self.chars.get(self.pos..self.pos + 4).map(|s| s.iter().collect()).unwrap_or_default();
                            if hex.len() != 4 { return Err(self.error("Invalid Unicode escape")); }
                            let unit = u16::from_str_radix(&hex, 16).map_err(|_| self.error("Invalid Unicode escape"))?;
                            self.pos += 4;
                            units.push(unit);
                        }
                        _ => return Err(self.error("Bad JSON escape sequence")),
                    }
                }
                c if !self.lenient() && (c as u32) < 0x20 => return Err(self.error("A control character is not allowed in a string")),
                c => { let mut buf = [0u16; 2]; units.extend_from_slice(c.encode_utf16(&mut buf)); }
            }
        }
        Ok(String::from_utf16_lossy(&units))
    }
}

/// Newtonsoft's reading of an ISO 8601 timestamp, written back the way `ConvertTo-Json` writes a
/// date: `yyyy-MM-ddTHH:mm:ss`, then the fraction without trailing zeros, then `Z` for UTC or
/// nothing for an unspecified kind. `None` when the text is not such a timestamp, in which case
/// it stays a string. A timestamp with a numeric offset keeps its offset here; Newtonsoft would
/// convert it to the machine's local time (recorded in parity/DIVERGENCES.md).
pub fn round_trip_date(text: &str) -> Option<String> {
    let b = text.as_bytes();
    if b.len() < 19 { return None; }
    let digit = |i: usize| b.get(i).is_some_and(|c| c.is_ascii_digit());
    let num = |from: usize, len: usize| -> u32 { text[from..from + len].parse().unwrap_or(u32::MAX) };
    let shape = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18].iter().all(|&i| digit(i));
    if !shape || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' { return None; }
    let (year, month, day, hour, minute, second) = (num(0, 4), num(5, 2), num(8, 2), num(11, 2), num(14, 2), num(17, 2));
    if year == 0 || !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let mut i = 19;
    let mut fraction = String::new();
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while digit(i) { i += 1; }
        if i == start || i - start > 7 { return None; }
        fraction = text[start..i].to_string();
    }
    let suffix = &text[i..];
    let valid_offset = |s: &str| {
        let s = s.as_bytes();
        (s.len() == 6 && s[3] == b':' && s[1..3].iter().chain(&s[4..6]).all(u8::is_ascii_digit))
            || (s.len() == 5 && s[1..5].iter().all(u8::is_ascii_digit))
    };
    let suffix_ok = suffix.is_empty() || suffix == "Z" || ((suffix.starts_with('+') || suffix.starts_with('-')) && valid_offset(suffix));
    if !suffix_ok { return None; }
    let trimmed = fraction.trim_end_matches('0');
    let mut out = text[..19].to_string();
    if !trimmed.is_empty() { out.push('.'); out.push_str(trimmed); }
    out.push_str(suffix);
    Some(out)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 { 29 } else { 28 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Json { parse(text, ReadOptions::CONVERT_FROM_JSON).unwrap() }

    #[test]
    fn keeps_key_order_and_writes_compact() {
        let value = read(r#"{ "b": 1, "a": [true, null, "x"], "c": {} }"#);
        assert_eq!(value.to_compact(), r#"{"b":1,"a":[true,null,"x"],"c":{}}"#);
    }

    #[test]
    fn escapes_like_newtonsoft() {
        // The test PC's ConvertTo-Json output for the same characters (probe, 2026-09-30).
        let text = "<>&'\"\\/ 中文 \u{1} \u{7f} \u{2028} 😀 é\n\t\u{85}";
        let mut out = String::new();
        write_string(text, &mut out);
        assert_eq!(out, "\"<>&'\\\"\\\\/ 中文 \\u0001 \u{7f} \\u2028 😀 é\\n\\t\\u0085\"");
        let mut control = String::new();
        write_string("\u{1f}", &mut control);
        assert_eq!(control, "\"\\u001f\"");
    }

    #[test]
    fn dates_come_back_in_round_trip_form() {
        assert_eq!(round_trip_date("2026-09-30T08:09:10.1230000Z").as_deref(), Some("2026-09-30T08:09:10.123Z"));
        assert_eq!(round_trip_date("2026-09-30T08:09:10.0000000Z").as_deref(), Some("2026-09-30T08:09:10Z"));
        assert_eq!(round_trip_date("2026-09-30T08:09:10.1234567Z").as_deref(), Some("2026-09-30T08:09:10.1234567Z"));
        assert_eq!(round_trip_date("2026-09-30"), None);
        assert_eq!(round_trip_date("09/30/2026"), None);
        assert_eq!(round_trip_date("2026-02-30T08:09:10Z"), None);
        let value = read(r#"{"CreatedAt":"2026-09-30T08:09:10.1230000Z"}"#);
        assert_eq!(value.to_compact(), r#"{"CreatedAt":"2026-09-30T08:09:10.123Z"}"#);
        let literal = parse(r#"{"d":"2026-09-30T08:09:10.1230000Z"}"#, ReadOptions { strings: Strings::Literal, ..ReadOptions::CONVERT_FROM_JSON }).unwrap();
        assert_eq!(literal.get("d").and_then(Json::as_str), Some("2026-09-30T08:09:10.1230000Z"));
    }

    #[test]
    fn duplicate_keys_follow_convert_from_json() {
        assert_eq!(read(r#"{"a":1,"b":2,"a":3}"#).to_compact(), r#"{"a":3,"b":2}"#);
        assert!(parse(r#"{"a":1,"A":2}"#, ReadOptions::CONVERT_FROM_JSON).is_err());
        let kept = parse(r#"{"a":1,"A":2}"#, ReadOptions { keys: Keys::KeepCaseVariants, ..ReadOptions::CONVERT_FROM_JSON }).unwrap();
        assert_eq!(kept.to_compact(), r#"{"a":1,"A":2}"#);
    }

    #[test]
    fn accepts_what_convert_from_json_accepts() {
        // Each input and its reading on the test PC (probe, 2026-09-30).
        let cases = [
            ("{\"a\":1 /*c*/}", r#"{"a":1}"#), ("{\"a\":1 // c\n}", r#"{"a":1}"#), ("{\"a\":1,}", r#"{"a":1}"#),
            ("[1,]", "[1]"), ("{'a':1}", r#"{"a":1}"#), ("{a:1}", r#"{"a":1}"#), ("{\"n\":NaN}", r#"{"n":NaN}"#),
            ("{\"a\":undefined}", r#"{"a":null}"#), ("{\"a\":01}", r#"{"a":1}"#), ("{\"a\":.5}", r#"{"a":.5}"#),
            ("{\"a\":\"x\ny\"}", "{\"a\":\"x\\ny\"}"), ("{\"a\":0x1F}", r#"{"a":31}"#), ("null", "null"), ("  ", "null"),
        ];
        for (input, expected) in cases { assert_eq!(read(input).to_compact(), expected, "{input}"); }
    }

    #[test]
    fn the_strict_grammar_is_rfc_json() {
        let strict = |t: &str| parse_with(t, ReadOptions::CONVERT_FROM_JSON, Grammar::Strict);
        for bad in ["{\"a\":1,}", "[1,]", "{'a':1}", "{a:1}", "{\"a\":NaN}", "{\"a\":01}", "/*c*/{}", "{\"a\":\"x\ny\"}", ""] {
            assert!(strict(bad).is_err(), "{bad}");
        }
        assert_eq!(strict(r#"{"a":[1,2.5e3,-0,"\u00e9"]}"#).unwrap().to_compact(), r#"{"a":[1,2.5e3,-0,"é"]}"#);
    }

    #[test]
    fn refuses_what_convert_from_json_refuses() {
        for bad in ["\u{feff}{}", "{\"a\":1} x", "{\"a\":+1}", "[1 2]", "{\"a\":1e}"] {
            assert!(parse(bad, ReadOptions::CONVERT_FROM_JSON).is_err(), "{bad}");
        }
        assert_eq!(read(""), Json::Null);
        assert_eq!(read("\"\\u0041\\ud83d\\ude00\""), Json::str("A😀"));
    }

    #[test]
    fn many_keys_parse_in_linear_time_and_keep_their_order() {
        let body: Vec<String> = (0..60_000).map(|i| format!("\"key{i}\":{i}")).collect();
        let text = format!("{{{}}}", body.join(","));
        let started = std::time::Instant::now();
        for options in [ReadOptions::CONVERT_FROM_JSON, ReadOptions { keys: Keys::KeepCaseVariants, ..ReadOptions::CONVERT_FROM_JSON }, ReadOptions { keys: Keys::RefuseDuplicates, ..ReadOptions::CONVERT_FROM_JSON }] {
            let Json::Object(fields) = parse(&text, options).unwrap() else { panic!("not an object") };
            assert_eq!(fields.len(), 60_000);
            assert_eq!((fields[0].0.as_str(), fields[59_999].0.as_str()), ("key0", "key59999"));
        }
        assert!(started.elapsed().as_secs() < 10, "{:?}", started.elapsed());
    }

    #[test]
    fn duplicate_and_case_variant_keys_are_refused_or_merged_by_mode() {
        let with = |text: &str, keys| parse(text, ReadOptions { keys, ..ReadOptions::CONVERT_FROM_JSON });
        assert_eq!(with(r#"{"a":1,"A":2}"#, Keys::RefuseCaseVariants).unwrap_err().0, "keys with different casing: \"A\"");
        assert_eq!(with(r#"{"a":1,"a":2}"#, Keys::RefuseDuplicates).unwrap_err().0, DUPLICATE_KEY);
        assert_eq!(with(r#"{"a":1,"b":2,"a":3}"#, Keys::KeepCaseVariants).unwrap().to_compact(), r#"{"a":3,"b":2}"#);
        assert_eq!(with(r#"{"a":1,"A":2}"#, Keys::KeepCaseVariants).unwrap().to_compact(), r#"{"a":1,"A":2}"#);
        assert_eq!(with(r#"{"a":1,"A":2}"#, Keys::RefuseDuplicates).unwrap().to_compact(), r#"{"a":1,"A":2}"#);
    }

    #[test]
    fn untrusted_json_nests_at_most_64_deep() {
        let nested = |n: usize| format!("{}1{}", "[".repeat(n), "]".repeat(n));
        assert!(parse(&nested(64), ReadOptions::CONVERT_FROM_JSON).is_ok());
        assert!(parse(&nested(65), ReadOptions::CONVERT_FROM_JSON).is_err());
    }
}
