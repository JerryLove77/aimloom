# Accepted differences between the PowerShell and Rust engines

Each entry says what differs, why it is accepted, and how the parity suite treats it.

| Where | Difference | Treatment |
|---|---|---|
| Operating-system error text | A .NET exception's message (a locked file, a missing folder) and a Rust `io::Error` word the same failure differently, and Windows localizes .NET's wording. | The step is recorded with `"compare": "code"`: only `ok` and the code. |
| JSON syntax error text | A message that quotes the JSON parser's own error (`Invalid JSON at "…" : <parser text>`, `Invalid JSON request: <parser text>`) differs: Newtonsoft and System.Text.Json word their errors their own way. | The step is recorded with `"compare": "code"`. |
| Invalid UTF-8 in a settings file | .NET and Rust both replace an invalid sequence with U+FFFD, but may emit a different number of replacement characters for one broken sequence. | Not covered by a case: the game writes valid UTF-8. |
| Timestamps with a numeric offset | Newtonsoft reads `…+08:00` as a local time and writes it back in the machine's own offset; Rust keeps the offset it read. | Not covered: both engines write only `Z` timestamps. |
| `Get-ChildItem` order | PowerShell lists a backup folder in the file system's order; Rust sorts by name. | Only the order in which manifests are validated differs; every list the App sees is sorted explicitly. |
| The native log's data-root rule | `worker.rs` `data_root` treats an old-name entry that is a file as the data folder; the engines use the new name then. | Only the log's location differs, in a state the engines never create. |
