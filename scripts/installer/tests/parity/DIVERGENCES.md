# Accepted differences between the PowerShell and Rust engines

Each entry says what differs, why it is accepted, and how the parity suite treats it. The
PowerShell engine was removed in 0.1.6-beta.2; its goldens are frozen (see `README.md`), and this
list records where the Rust engine was accepted to differ from them.

| Where | Difference | Treatment |
|---|---|---|
| Operating-system error text | A .NET exception's message (a locked file, a missing folder) and a Rust `io::Error` word the same failure differently, and Windows localizes .NET's wording. | The step is recorded with `"compare": "code"`: only `ok` and the code. |
| JSON syntax error text | A message that quotes the JSON parser's own error (`Invalid JSON at "…" : <parser text>`, `Invalid JSON request: <parser text>`) differs: Newtonsoft and System.Text.Json word their errors their own way. | The step is recorded with `"compare": "code"`. |
| Invalid UTF-8 in a settings file | .NET and Rust both replace an invalid sequence with U+FFFD, but may emit a different number of replacement characters for one broken sequence. | Not covered by a case: the game writes valid UTF-8. |
| Timestamps with a numeric offset | Newtonsoft reads `…+08:00` as a local time and writes it back in the machine's own offset; Rust keeps the offset it read. | Not covered: both engines write only `Z` timestamps. |
| `Get-ChildItem` order | PowerShell lists a backup folder in the file system's order; Rust sorts by name. | Only the order in which manifests are validated differs; every list the App sees is sorted explicitly. |
| The native log's data-root rule | `worker.rs` `data_root` treats an old-name entry that is a file as the data folder; the engines use the new name then. | Only the log's location differs, in a state the engines never create. |
| An interrupted install's temporary copy | When the worker stops while copying a file into the game, the copy `<target>.kvk-<batch>-<guid>.tmp` is left beside its target and no record names it. The PowerShell engine left it after recovery; the Rust engine removes it when that batch is restored (beta2 real-game test, 2026-09-30), matching only that batch's own temp names. | `restore-after-recovery-required`'s golden was edited by hand to drop that file. |
| Wire names for the Theme section | THEME-RENAME (2026-10-01): the operations `schemeList` and `planScheme` are `themeList` and `planTheme`, and the asset kind `scheme` is `theme`. Replies, files on disk and the `scheme-previews` staging folder are unchanged. | The five `scheme-*` cases are named `theme-*`; requests in the cases were renamed by hand. No recorded reply or file changed. |
| Import preview ownership locks | Rust holds a cross-process lease for each live Quick import or FileAdd preview so another session cannot remove it as an orphan. Empty `Aimloom/locks/import-<64 lowercase hex>.lock` files persist after release; unlinking them could split a Unix lock across two inodes. | The local-data file recorder asserts these files are empty and excludes only this exact path pattern. All other files, including staging contents, game files and backups, are still compared. Multi-session tests cover active-plan protection, owner exit and cleanup. |
