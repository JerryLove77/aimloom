//! Engine parity: every case in `scripts/installer/tests/parity/cases/` runs through the Rust
//! engine, and what it observes must equal the golden the PowerShell engine wrote
//! (`parity.test.ps1 -Write`, on Windows). The case format and the normalization are specified
//! in that folder's README.md; `parity.test.ps1` implements the same steps, and the two change
//! together.
//!
//! A case without a golden is reported and skipped, unless `KVK_PARITY_REQUIRE=1` (CI) makes it
//! a failure. `KVK_PARITY_OUT=<dir>` writes the Rust engine's own records there for comparison.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use app_lib::engine::json::{self, Json};
use app_lib::engine::session::{parse_request, Session};
use app_lib::engine::store::Host;
use app_lib::engine::text::lower_invariant;
use app_lib::engine::{paths, platform, EngineError, EngineResult};

fn parity_dir() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../scripts/installer/tests/parity") }

#[derive(Default)]
struct HostState {
    listings: Cell<usize>,
    running_from: Cell<Option<usize>>,
    faults: RefCell<Vec<String>>,
    steam_roots: RefCell<Vec<String>>,
    drives: RefCell<Vec<String>>,
    env: RefCell<Vec<(String, String)>>,
}

struct ParityHost(Rc<HostState>);

impl Host for ParityHost {
    fn process_names(&self) -> std::io::Result<Vec<String>> {
        let n = self.0.listings.get() + 1;
        self.0.listings.set(n);
        let running = self.0.running_from.get().is_some_and(|from| n >= from);
        Ok(vec![if running { "FPSAimTrainer" } else { "explorer" }.to_string()])
    }

    fn fault(&self, point: &str) -> EngineResult<()> {
        if self.0.faults.borrow().iter().any(|f| f == point) { return Err(EngineError::plain(format!("Injected failure at {point}"))); }
        Ok(())
    }

    fn steam_roots(&self) -> Vec<String> { self.0.steam_roots.borrow().clone() }

    fn drive_roots(&self) -> Vec<String> { self.0.drives.borrow().clone() }

    fn env(&self, name: &str) -> Option<String> { self.0.env.borrow().iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()) }
}

fn repo_root() -> String { paths::get_full_path(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").to_string_lossy()).unwrap() }

fn runtime_root() -> String { Path::new(&repo_root()).join("scripts/installer").to_string_lossy().into_owned() }

fn literal(text: &str) -> Json {
    json::parse(text, json::ReadOptions { strings: json::Strings::Literal, keys: json::Keys::KeepCaseVariants, max_depth: 64 }).unwrap()
}

struct Roots { root: String, game: String, pack: String }

fn resolve(value: &Json, roots: &Roots, plan: &str, batch: &str) -> Json {
    match value {
        Json::String(s) if s == "<plan>" => Json::str(plan),
        Json::String(s) if s == "<batch>" => Json::str(batch),
        Json::String(s) if s.starts_with("<game>") => Json::str(format!("{}{}", roots.game, &s[6..])),
        Json::String(s) if s.starts_with("<pack>") => Json::str(format!("{}{}", roots.pack, &s[6..])),
        Json::String(s) if s.starts_with("<root>") => Json::str(format!("{}{}", roots.root, &s[6..])),
        Json::Object(fields) => Json::Object(fields.iter().map(|(k, v)| (k.clone(), resolve(v, roots, plan, batch))).collect()),
        Json::Array(items) => Json::Array(items.iter().map(|v| resolve(v, roots, plan, batch)).collect()),
        other => other.clone(),
    }
}

fn write_files(root: &Path, files: Option<&Json>, fixtures: &Path, case_root: &str) {
    let Some(Json::Object(entries)) = files else { return };
    for (relative, spec) in entries {
        let path = root.join(relative);
        if spec.get("dir").is_some() { std::fs::create_dir_all(&path).unwrap(); continue; }
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        match spec.get("fixture").and_then(Json::as_str) {
            Some(fixture) => { std::fs::copy(fixtures.join(fixture), &path).unwrap(); }
            None => std::fs::write(&path, spec.get("text").and_then(Json::as_str).unwrap().replace("<root>", case_root)).unwrap(),
        }
    }
}

enum Recorded { Text(String), File { size: usize, sha256: String } }

fn files(root: &Path) -> Vec<(String, Recorded)> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Recorded)>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { walk(root, &path, out); continue; }
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            let bytes = std::fs::read(&path).unwrap();
            let recorded = if path.file_name().is_some_and(|n| n == "manifest.json") {
                Recorded::Text(String::from_utf8_lossy(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&bytes)).into_owned())
            } else {
                Recorded::File { size: bytes.len(), sha256: paths::sha256_hex(&bytes) }
            };
            out.push((relative, recorded));
        }
    }
    walk(root, root, &mut out);
    out
}

/// README.md "Normalization", steps 1-6, shared state for one case.
struct Normalizer { roots: Vec<(String, String)>, game_hash: String, pristine: Vec<(String, String)>, guids: Vec<(String, String)> }

fn hex(b: u8) -> bool { b.is_ascii_digit() || (b'a'..=b'f').contains(&b) }

/// Byte ranges of every 32-hex run that is not part of a longer hex run.
fn guid_ranges(text: &str) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if hex(b[i]) {
            let start = i;
            while i < b.len() && hex(b[i]) { i += 1; }
            if i - start == 32 { out.push((start, i)); }
        } else { i += 1; }
    }
    out
}

/// `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z` replaced by `<time>`.
fn mask_times(text: &str) -> String {
    let b = text.as_bytes();
    let (mut out, mut i, mut copied) = (String::new(), 0, 0);
    let d = |j: usize| b.get(j).is_some_and(u8::is_ascii_digit);
    while i + 20 <= b.len() {
        let head = (0..4).all(|k| d(i + k)) && b[i + 4] == b'-' && d(i + 5) && d(i + 6) && b[i + 7] == b'-' && d(i + 8) && d(i + 9)
            && b[i + 10] == b'T' && d(i + 11) && d(i + 12) && b[i + 13] == b':' && d(i + 14) && d(i + 15) && b[i + 16] == b':' && d(i + 17) && d(i + 18);
        if head {
            let mut end = i + 19;
            if b.get(end) == Some(&b'.') {
                let mut j = end + 1;
                while d(j) { j += 1; }
                if (1..=7).contains(&(j - end - 1)) && b.get(j) == Some(&b'Z') { end = j; }
            }
            if b.get(end) == Some(&b'Z') {
                out.push_str(&text[copied..i]);
                out.push_str("<time>");
                i = end + 1;
                copied = i;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&text[copied..]);
    out
}

impl Normalizer {
    fn text(&self, text: &str) -> String {
        let mut t = text.to_string();
        for (from, to) in &self.roots { t = t.replace(from, to); }
        t = t.replace(&self.game_hash, "<gamehash>").replace("\\\\", "/");
        for (from, to) in &self.pristine { t = t.replace(from, to); }
        mask_times(&t)
    }

    fn register(&mut self, text: &str) {
        for (s, e) in guid_ranges(text) {
            let g = &text[s..e];
            if !self.guids.iter().any(|(k, _)| k == g) { let n = self.guids.len() + 1; self.guids.push((g.to_string(), format!("<guid#{n}>"))); }
        }
    }

    fn apply(&self, text: &str, unknown: bool) -> String {
        let mut out = String::new();
        let mut last = 0;
        for (s, e) in guid_ranges(text) {
            out.push_str(&text[last..s]);
            match self.guids.iter().find(|(k, _)| k == &text[s..e]) {
                Some((_, v)) => out.push_str(v),
                None if unknown => out.push_str("<guid>"),
                None => out.push_str(&text[s..e]),
            }
            last = e;
        }
        out.push_str(&text[last..]);
        out
    }
}

fn run_case(name: &str, case: &Json) -> Json {
    let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let root = base.join(format!("kvk-parity-{}", app_lib::engine::store::new_guid()));
    let game = paths::get_full_path(&root.join("游戏 with spaces").to_string_lossy()).unwrap();
    let local = paths::get_full_path(&root.join("Local Data").to_string_lossy()).unwrap();
    let pack = paths::get_full_path(&root.join("配置 pack").to_string_lossy()).unwrap();
    let case_root = paths::get_full_path(&root.to_string_lossy()).unwrap();
    let roots = Roots { root: case_root.clone(), game: game.clone(), pack: pack.clone() };
    let primary = Path::new(&game).join("FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json");
    let fixtures = parity_dir().join("fixtures");
    std::fs::create_dir_all(primary.parent().unwrap()).unwrap();
    std::fs::create_dir_all(Path::new(&game).join("FPSAimTrainer/sounds")).unwrap();
    std::fs::create_dir_all(&local).unwrap();
    std::fs::copy(fixtures.join(case.get("fixture").and_then(Json::as_str).unwrap()), &primary).unwrap();
    write_files(Path::new(&game), case.get("gameFiles"), &fixtures, &case_root);
    if case.get("packFiles").is_some() { std::fs::create_dir_all(&pack).unwrap(); write_files(Path::new(&pack), case.get("packFiles"), &fixtures, &case_root); }
    write_files(Path::new(&local), case.get("localFiles"), &fixtures, &case_root);
    write_files(Path::new(&case_root), case.get("rootFiles"), &fixtures, &case_root);
    let host = Rc::new(HostState::default());
    if let Some(machine) = case.get("machine") {
        let list = |key: &str| machine.get(key).and_then(Json::as_array).map(|a| a.iter().map(|v| resolve(v, &roots, "", "").as_str().unwrap().to_string()).collect()).unwrap_or_default();
        *host.steam_roots.borrow_mut() = list("steamRoots");
        *host.drives.borrow_mut() = list("drives");
        if let Some(Json::Object(env)) = machine.get("env") {
            *host.env.borrow_mut() = env.iter().map(|(k, v)| (k.clone(), resolve(v, &roots, "", "").as_str().unwrap().to_string())).collect();
        }
    }
    let mut session = Session::new(Box::new(ParityHost(host.clone())), &local, &runtime_root()).unwrap();
    let mut steps: Vec<(Vec<String>, String)> = Vec::new();
    let (mut lock, mut last_plan, mut last_batch, mut number) = (None, "<plan>".to_string(), "<batch>".to_string(), 0);
    for step in case.get("steps").and_then(Json::as_array).unwrap() {
        if step.get("request").is_some() || step.get("raw").is_some() || step.get("line").is_some() {
            number += 1;
            let line = match (step.get("line"), step.get("raw")) {
                (Some(line), _) => line.as_str().unwrap().to_string(),
                (None, Some(raw)) => raw.to_compact(),
                (None, None) => Json::object(vec![
                    ("v", Json::int(1)), ("requestId", Json::str(format!("r{number}"))),
                    ("op", step.get("request").cloned().unwrap()), ("args", resolve(step.get("args").unwrap(), &roots, &last_plan, &last_batch)),
                ]).to_compact(),
            };
            let mut progress = Vec::new();
            // A line the worker cannot parse is answered by the worker loop itself.
            let reply = match parse_request(&line) {
                Ok(request) => session.handle(&request, &mut |line| progress.push(line.to_compact())),
                Err(error) => parse_failure(&format!("Invalid JSON request: {error}")),
            };
            let ok = reply.get("ok") == Some(&Json::Bool(true));
            let text = if step.get("compare").and_then(Json::as_str) == Some("code") {
                let code = if ok { Json::Null } else { reply.get("error").and_then(|e| e.get("code")).cloned().unwrap_or(Json::Null) };
                Json::object(vec![("ok", Json::Bool(ok)), ("code", code)]).to_compact()
            } else { reply.to_compact() };
            if let Some(plan) = reply.get("data").and_then(|d| d.get("planId")).and_then(Json::as_str).filter(|_| ok) { last_plan = plan.to_string(); }
            if let Some(batch) = reply.get("data").and_then(|d| d.get("batchId")).and_then(Json::as_str).filter(|_| ok) { last_batch = batch.to_string(); }
            steps.push((progress, text));
        } else if let Some(file) = step.get("setPrimary").and_then(Json::as_str) {
            std::fs::copy(fixtures.join(file), &primary).unwrap();
        } else if let Some(extra) = step.get("appendPrimary").and_then(Json::as_str) {
            let mut bytes = std::fs::read(&primary).unwrap();
            bytes.extend_from_slice(extra.as_bytes());
            std::fs::write(&primary, bytes).unwrap();
        } else if let Some(from) = step.get("gameRunningFrom") {
            host.running_from.set(match from { Json::Number(n) => Some(host.listings.get() + n.parse::<usize>().unwrap()), _ => None });
        } else if let Some(fault) = step.get("fault").and_then(Json::as_str) {
            host.faults.borrow_mut().push(fault.to_string());
        } else if step.get("clearFaults").is_some() {
            host.faults.borrow_mut().clear();
        } else if step.get("holdLock").is_some() {
            let locks = Path::new(&local).join("Aimloom/locks");
            std::fs::create_dir_all(&locks).unwrap();
            lock = Some(platform::open_exclusive(&locks.join("palette.lock")).unwrap());
        } else if step.get("releaseLock").is_some() {
            lock = None;
        } else {
            panic!("unknown step in case {name}: {}", step.to_compact());
        }
    }
    drop(lock);
    drop(session);
    let game_files = files(Path::new(&game));
    let local_files = files(Path::new(&local));
    let _ = std::fs::remove_dir_all(&root);

    let json_root = |p: &str| p.replace('\\', "\\\\").replace('"', "\\\"");
    let mut n = Normalizer {
        roots: vec![
            (json_root(&game), "<game>".into()), (json_root(&local), "<local>".into()), (json_root(&pack), "<pack>".into()),
            (json_root(&case_root), "<root>".into()), (json_root(&repo_root()), "<repo>".into()),
            (game.clone(), "<game>".into()), (local.clone(), "<local>".into()), (pack.clone(), "<pack>".into()),
            (case_root.clone(), "<root>".into()), (repo_root(), "<repo>".into()),
        ],
        game_hash: paths::text_hash(&lower_invariant(&game)),
        pristine: Vec::new(),
        guids: Vec::new(),
    };
    let mut pristine: Vec<&String> = local_files.iter().map(|(p, _)| p).filter(|p| {
        p.len() > 68 && p.ends_with(".bin") && p[..p.len() - 68].ends_with("/pristine/files/") && p[p.len() - 68..p.len() - 4].bytes().all(hex)
    }).collect();
    pristine.sort();
    for p in pristine { let k = n.pristine.len() + 1; n.pristine.push((p[p.len() - 68..p.len() - 4].to_string(), format!("<pristine#{k}>"))); }

    let mut out_steps = Vec::new();
    for (progress, reply) in &steps {
        let lines: Vec<String> = progress.iter().map(|l| n.text(l)).collect();
        let reply = n.text(reply);
        for l in &lines { n.register(l); }
        n.register(&reply);
        out_steps.push(Json::object(vec![
            ("progress", Json::Array(lines.iter().map(|l| Json::str(n.apply(l, false))).collect())),
            ("reply", Json::str(n.apply(&reply, false))),
        ]));
    }
    let mut out_files = Vec::new();
    for (group, list) in [("game", &game_files), ("local", &local_files)] {
        let mut items: Vec<(String, String, &Recorded)> = list.iter().map(|(p, r)| { let path = n.text(p); (n.apply(&path, true), path, r) }).collect();
        items.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        let mut entries = Vec::new();
        for (_, path, recorded) in items {
            n.register(&path);
            let mut entry = vec![("path".to_string(), Json::str(n.apply(&path, false)))];
            match recorded {
                Recorded::Text(text) => { let t = n.text(text); n.register(&t); entry.push(("text".to_string(), Json::str(n.apply(&t, false)))); }
                Recorded::File { size, sha256 } => { entry.push(("size".to_string(), Json::int(*size as i64))); entry.push(("sha256".to_string(), Json::str(sha256))); }
            }
            entries.push(Json::Object(entry));
        }
        out_files.push((group.to_string(), Json::Array(entries)));
    }
    Json::object(vec![("case", Json::str(name)), ("steps", Json::Array(out_steps)), ("files", Json::Object(out_files))])
}

/// `Write-KvkGuiParseFailure`.
fn parse_failure(message: &str) -> Json {
    let english = app_lib::engine::english_text(message, Some(message));
    let issue = Json::object(vec![("code", Json::str("ENGINE_ERROR")), ("message", Json::str(message)), ("messageEn", Json::str(english)), ("path", Json::Null)]);
    Json::object(vec![("v", Json::int(1)), ("requestId", Json::Null), ("type", Json::str("reply")), ("ok", Json::Bool(false)), ("error", issue)])
}

/// The first place two records differ, for the failure message.
fn first_difference(path: &str, a: &Json, b: &Json) -> Option<String> {
    match (a, b) {
        (Json::Object(x), Json::Object(y)) => {
            if x.iter().map(|(k, _)| k).ne(y.iter().map(|(k, _)| k)) { return Some(format!("{path}: keys differ")); }
            x.iter().zip(y).find_map(|((k, v), (_, w))| first_difference(&format!("{path}.{k}"), v, w))
        }
        (Json::Array(x), Json::Array(y)) => {
            if x.len() != y.len() { return Some(format!("{path}: {} items in PowerShell, {} in Rust", x.len(), y.len())); }
            x.iter().zip(y).enumerate().find_map(|(i, (v, w))| first_difference(&format!("{path}[{i}]"), v, w))
        }
        _ if a == b => None,
        _ => Some(format!("{path}:\n  PowerShell: {}\n  Rust:       {}", a.to_compact(), b.to_compact())),
    }
}

#[test]
fn every_case_matches_its_powershell_golden() {
    let dir = parity_dir();
    let mut names: Vec<PathBuf> = std::fs::read_dir(dir.join("cases")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "json")).collect();
    names.sort();
    let out = std::env::var_os("KVK_PARITY_OUT").map(PathBuf::from);
    let (mut missing, mut failures, mut matched) = (Vec::new(), Vec::new(), 0);
    for path in names {
        let name = path.file_stem().unwrap().to_string_lossy().into_owned();
        let case = literal(&std::fs::read_to_string(&path).unwrap());
        let record = run_case(&name, &case);
        if let Some(out) = &out {
            std::fs::create_dir_all(out).unwrap();
            std::fs::write(out.join(format!("{name}.json")), format!("{}\n", record.to_compact())).unwrap();
        }
        match std::fs::read_to_string(dir.join("goldens").join(format!("{name}.json"))) {
            Err(_) => missing.push(name),
            Ok(text) => match first_difference(&name, &literal(&text), &record) {
                None => matched += 1,
                Some(difference) => failures.push(difference),
            },
        }
    }
    eprintln!("engine parity: {matched} cases match their PowerShell goldens");
    if !missing.is_empty() {
        eprintln!("engine parity: no golden yet for {}", missing.join(", "));
        assert!(std::env::var_os("KVK_PARITY_REQUIRE").is_none(), "missing goldens: {}", missing.join(", "));
    }
    assert!(failures.is_empty(), "the Rust engine differs from PowerShell:\n{}", failures.join("\n\n"));
}
