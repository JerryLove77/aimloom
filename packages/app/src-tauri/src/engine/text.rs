//! Text as the PowerShell engine sees it: .NET strings are UTF-16, so every index, `IndexOf`
//! and `char.IsWhiteSpace` here works on UTF-16 code units, and a settings edit is a splice of
//! code units that is encoded back with the file's own encoding and preamble.

use super::EngineError;

/// The encodings `Get-KvkTextFile` tells apart by the file's first bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextEncoding { Utf8Bom, Utf8, Utf16Le, Utf16Be }

impl TextEncoding {
    pub fn preamble(self) -> &'static [u8] {
        match self {
            TextEncoding::Utf8Bom => &[0xEF, 0xBB, 0xBF],
            TextEncoding::Utf8 => &[],
            TextEncoding::Utf16Le => &[0xFF, 0xFE],
            TextEncoding::Utf16Be => &[0xFE, 0xFF],
        }
    }

    /// The file's bytes for `text`: preamble, then the encoded code units. A lone surrogate
    /// becomes U+FFFD, as .NET's encoders do.
    pub fn encode(self, text: &[u16]) -> Vec<u8> {
        let mut out = self.preamble().to_vec();
        match self {
            TextEncoding::Utf8Bom | TextEncoding::Utf8 => out.extend_from_slice(String::from_utf16_lossy(text).as_bytes()),
            TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
                let fixed: Vec<u16> = String::from_utf16_lossy(text).encode_utf16().collect();
                for unit in fixed {
                    out.extend_from_slice(&if self == TextEncoding::Utf16Le { unit.to_le_bytes() } else { unit.to_be_bytes() });
                }
            }
        }
        out
    }
}

/// `Get-KvkTextFile`: the bytes, the encoding they were sniffed as, and the decoded text.
pub struct TextFile { pub encoding: TextEncoding, pub text: Vec<u16> }

impl TextFile {
    pub fn decode(bytes: &[u8]) -> TextFile {
        let encoding = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { TextEncoding::Utf8Bom }
            else if bytes.starts_with(&[0xFF, 0xFE]) { TextEncoding::Utf16Le }
            else if bytes.starts_with(&[0xFE, 0xFF]) { TextEncoding::Utf16Be }
            else { TextEncoding::Utf8 };
        let body = &bytes[encoding.preamble().len()..];
        let text = match encoding {
            // Invalid UTF-8 becomes U+FFFD. The count of replacement characters for a broken
            // sequence can differ from .NET's (recorded in parity/DIVERGENCES.md).
            TextEncoding::Utf8Bom | TextEncoding::Utf8 => String::from_utf8_lossy(body).encode_utf16().collect(),
            TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
                let units: Vec<u16> = body.chunks(2).map(|pair| {
                    let (a, b) = (pair[0], *pair.get(1).unwrap_or(&0));
                    if encoding == TextEncoding::Utf16Le { u16::from_le_bytes([a, b]) } else { u16::from_be_bytes([a, b]) }
                }).collect();
                // .NET replaces a lone surrogate (and a trailing odd byte) with U+FFFD.
                let mut fixed: Vec<u16> = String::from_utf16_lossy(&units).encode_utf16().collect();
                if body.len() % 2 == 1 { if let Some(last) = fixed.last_mut() { *last = 0xFFFD; } }
                fixed
            }
        };
        TextFile { encoding, text }
    }
}

pub fn utf16(text: &str) -> Vec<u16> { text.encode_utf16().collect() }

/// `char.IsWhiteSpace` for one UTF-16 code unit.
pub fn is_white_space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0x85 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000)
}

fn index_of(haystack: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() || from > haystack.len() { return None; }
    haystack[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

/// A value's span inside a text, as `Find-KvkJsonValue` returns it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span { pub key_start: usize, pub value_start: usize, pub value_end: usize }

/// `Get-KvkJsonStringEnd`: the index just past the closing quote of the string at `start`.
pub fn string_end(text: &[u16], start: usize) -> Result<usize, EngineError> {
    let mut index = start + 1;
    while index < text.len() {
        if text[index] == b'\\' as u16 { index += 2; continue; }
        if text[index] == b'"' as u16 { return Ok(index + 1); }
        index += 1;
    }
    Err(EngineError::coded("ENGINE_ERROR", "设置文件中的字符串没有结束引号。", "A string in the settings file has no closing quote."))
}

/// `Get-KvkJsonValueEnd`: the end of the value that starts at `start`. Objects and arrays count
/// only their own bracket kind, and skip strings; a scalar runs to whitespace, `,`, `}` or `]`.
pub fn value_end(text: &[u16], start: usize) -> Result<usize, EngineError> {
    if start >= text.len() {
        return Err(EngineError::coded("ENGINE_ERROR", "设置文件意外结束。", "The settings file ended unexpectedly."));
    }
    let first = text[start];
    if first == b'"' as u16 { return string_end(text, start); }
    if first == b'{' as u16 || first == b'[' as u16 {
        let close = if first == b'{' as u16 { b'}' as u16 } else { b']' as u16 };
        let (mut depth, mut index) = (0i64, start);
        while index < text.len() {
            let c = text[index];
            if c == b'"' as u16 { index = string_end(text, index)?; continue; }
            if c == first { depth += 1; } else if c == close { depth -= 1; if depth == 0 { return Ok(index + 1); } }
            index += 1;
        }
        return Err(EngineError::coded("ENGINE_ERROR", "设置文件中的对象没有结束括号。", "An object in the settings file has no closing brace."));
    }
    let mut index = start;
    while index < text.len() && !is_white_space(text[index]) && ![b',' as u16, b'}' as u16, b']' as u16].contains(&text[index]) { index += 1; }
    Ok(index)
}

/// `Find-KvkJsonValue`: the first `"key"` anywhere in the text that is followed (after
/// whitespace) by a colon, and the span of its value. A plain text search, not a JSON walk: it
/// matches at any depth, which callers narrow by searching inside an enclosing value's region.
pub fn find_value(text: &[u16], key: &str) -> Result<Option<Span>, EngineError> {
    let needle = utf16(&format!("\"{key}\""));
    let mut from = 0;
    loop {
        let Some(index) = index_of(text, &needle, from) else { return Ok(None) };
        let mut cursor = index + needle.len();
        while cursor < text.len() && is_white_space(text[cursor]) { cursor += 1; }
        if cursor < text.len() && text[cursor] == b':' as u16 {
            let mut value_start = cursor + 1;
            while value_start < text.len() && is_white_space(text[value_start]) { value_start += 1; }
            return Ok(Some(Span { key_start: index, value_start, value_end: value_end(text, value_start)? }));
        }
        from = index + needle.len();
    }
}

/// `ConvertTo-KvkJsonScalar` for a string: only `\`, `"`, backspace, form feed, newline,
/// carriage return and tab are escaped.
pub fn json_scalar_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"").replace('\u{8}', "\\b").replace('\u{c}', "\\f")
        .replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t");
    format!("\"{escaped}\"")
}

/// `double.ToString("R", InvariantCulture)` on .NET Core 3.0 and later: the shortest digits that
/// read back as the same double, in fixed notation unless the decimal point would sit more than
/// 17 digits right or more than 3 zeros left of them (probes, 2026-09-30 and 2026-10-01: `1E+16` prints as
/// `10000000000000000`, `1E+21` as `1E+21`, `1.23E-4` as `0.000123`, `1E-7` as `1E-07`).
pub fn double_r(value: f64) -> String {
    if value.is_nan() { return "NaN".to_string(); }
    if value.is_infinite() { return if value > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() }; }
    if value == 0.0 { return if value.is_sign_negative() { "-0".to_string() } else { "0".to_string() }; }
    // Rust's `{:e}` gives the same shortest round-trip digits: d.ddde±x.
    let formatted = format!("{:e}", value.abs());
    let (mantissa, exponent) = formatted.split_once('e').unwrap_or((&formatted, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let scale = exponent + 1;
    let sign = if value < 0.0 { "-" } else { "" };
    let count = digits.len() as i32;
    if scale > 17 || scale < -3 {
        let rest = &digits[1..];
        let mantissa = if rest.is_empty() { digits[..1].to_string() } else { format!("{}.{}", &digits[..1], rest) };
        let exp_sign = if exponent < 0 { '-' } else { '+' };
        return format!("{sign}{mantissa}E{exp_sign}{:02}", exponent.abs());
    }
    if scale <= 0 { return format!("{sign}0.{}{}", "0".repeat((-scale) as usize), digits); }
    if scale >= count { return format!("{sign}{}{}", digits, "0".repeat((scale - count) as usize)); }
    format!("{sign}{}.{}", &digits[..scale as usize], &digits[scale as usize..])
}

/// `text[..start] + replacement + text[end..]`.
pub fn splice(text: &[u16], start: usize, end: usize, replacement: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len() + replacement.len());
    out.extend_from_slice(&text[..start]);
    out.extend_from_slice(replacement);
    out.extend_from_slice(&text[end..]);
    out
}

/// .NET's invariant simple case mapping, one character at a time: a character whose full
/// mapping is longer than one character (`İ`, `ß`) keeps its own form, as the probe showed.
fn simple_map(c: char, upper: bool) -> char {
    let mut mapped = if upper { c.to_uppercase().collect::<Vec<_>>() } else { c.to_lowercase().collect::<Vec<_>>() };
    if mapped.len() == 1 { mapped.pop().unwrap_or(c) } else { c }
}

/// `ToLowerInvariant`.
pub fn lower_invariant(text: &str) -> String { text.chars().map(|c| simple_map(c, false)).collect() }

/// `String.Equals(a, b, OrdinalIgnoreCase)` (also PowerShell's `-ieq` for the names compared here).
pub fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.chars().count() == b.chars().count() && a.chars().zip(b.chars()).all(|(x, y)| x == y || simple_map(x, true) == simple_map(y, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_value_matches_the_powershell_scan() {
        let text = utf16("{\r\n\t\"characterModelOverride\":\r\n\t{\r\n\t\t\"Cylindrical\": { \"characterModel\": \"Ghost\" }\r\n\t}\r\n}");
        let span = find_value(&text, "characterModelOverride").unwrap().unwrap();
        assert_eq!(text[span.value_start], b'{' as u16);
        assert_eq!(text[span.value_end - 1], b'}' as u16);
        let model = find_value(&text, "characterModel").unwrap().unwrap();
        assert_eq!(String::from_utf16_lossy(&text[model.value_start..model.value_end]), "\"Ghost\"");
        assert!(find_value(&text, "missing").unwrap().is_none());
    }

    #[test]
    fn a_key_inside_a_string_without_a_colon_is_skipped() {
        let text = utf16(r#"{"note":"\"a\" here","a" : 12 }"#);
        let span = find_value(&text, "a").unwrap().unwrap();
        assert_eq!(String::from_utf16_lossy(&text[span.value_start..span.value_end]), "12");
    }

    #[test]
    fn unterminated_values_fail_in_both_languages() {
        let error = find_value(&utf16(r#"{"a": "open"#), "a").unwrap_err();
        assert_eq!(error.code, "ENGINE_ERROR");
        assert_eq!(error.message_en, "A string in the settings file has no closing quote.");
        let brace = find_value(&utf16(r#"{"a": {"b":1"#), "a").unwrap_err();
        assert_eq!(brace.message_en, "An object in the settings file has no closing brace.");
    }

    #[test]
    fn encodings_round_trip_with_their_preamble() {
        for encoding in [TextEncoding::Utf8Bom, TextEncoding::Utf8, TextEncoding::Utf16Le, TextEncoding::Utf16Be] {
            let bytes = encoding.encode(&utf16("{\"名\":\"é😀\"}\r\n"));
            let file = TextFile::decode(&bytes);
            assert_eq!(file.encoding, encoding);
            assert_eq!(file.encoding.encode(&file.text), bytes);
        }
    }

    #[test]
    fn doubles_print_like_dotnet_r() {
        // Probe results from the test PC (2026-09-30).
        let cases = [(0.1, "0.1"), (0.91, "0.91"), (1e21, "1E+21"), (1e-7, "1E-07"), (123456789.123, "123456789.123"), (5e-324, "5E-324"),
            (1.7976931348623157e308, "1.7976931348623157E+308"), (-0.0, "-0"), (100.0, "100"), (2.5, "2.5"), (1e15, "1000000000000000"),
            (1e16, "10000000000000000"), (0.000123, "0.000123"), (4.35, "4.35"), (0.3, "0.3"),
            // Second probe round (2026-10-01): where each notation ends.
            (1e17, "1E+17"), (1e20, "1E+20"), (123456789012345678.0, "1.2345678901234568E+17"), (12345678901234567.0, "12345678901234568"),
            (1e-5, "1E-05"), (1e-4, "0.0001"), (0.0001234, "0.0001234")];
        for (value, expected) in cases { assert_eq!(double_r(value), expected, "{value:e}"); }
    }

    #[test]
    fn scalar_and_case_rules() {
        assert_eq!(json_scalar_string("a\"b\\c\n\u{1}/"), "\"a\\\"b\\\\c\\n\u{1}/\"");
        // Probe results from the test PC (2026-09-30).
        assert_eq!(lower_invariant("İ"), "İ");
        assert_eq!(lower_invariant("ΑΣ"), "ασ");
        assert_eq!(lower_invariant("ẞ"), "ß");
        assert_eq!(lower_invariant("K"), "k");
        assert_eq!(lower_invariant("C:\\Users\\Player1\\游戏"), "c:\\users\\player1\\游戏");
        assert!(eq_ignore_case("PrimaryUserSettings.JSON", "primaryusersettings.json"));
        assert!(!eq_ignore_case("a", "b"));
    }
}
