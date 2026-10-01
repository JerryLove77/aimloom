# scripts/installer

What remains here after the PowerShell engine was retired (0.1.6-beta.2). The engine, the
console wizard (`安装配置.cmd` / `恢复配置.cmd`), the GUI worker and their suites are in the
history before that release; the App's engine is the Rust one in
`packages/app/src-tauri/src/engine/`.

- `test-build/`: the Windows build and packaging scripts. `build-exe.ps1` builds `Aimloom.exe`
  with local paths remapped; `package-test-build.ps1` makes the folder and the portable ZIP
  (`Aimloom.exe`, the channel readmes from `channels/<channel>/`, `VERSION.txt`);
  `package-setup.ps1` bundles the Setup; `assert-no-local-paths.ps1` refuses an EXE that still
  carries the builder's user name, PC name or `C:\Users\`. See `CLAUDE.md`, "Release packaging".
- `tests/package-build.test.ps1`: the packagers' suite (Windows, PowerShell 7; CI runs it).
- `tests/parity/`: the 48 cases and the goldens the PowerShell engine wrote, now frozen. The
  Rust test `tests/engine_parity.rs` runs every case through the Rust engine and must observe the
  same thing. See that folder's README.

A debug build of the App uses this folder as its runtime root, so the engine's discovery finds the
synthetic sample pack `KVK Settings 2025/` at the repository root (`tests/rust_worker.rs`).
