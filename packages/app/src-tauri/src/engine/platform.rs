//! The operating-system calls whose .NET semantics the engine relies on, one place per call.
//! On Windows each is the Win32 call .NET makes; elsewhere (the Mac and Linux, where only tests
//! run) the closest POSIX equivalent, as .NET on Unix does.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// `new FileStream(path, CreateNew, Write, FileShare.None, 4096, WriteThrough)` + `Flush(true)`.
pub fn write_new_durable(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_WRITE_THROUGH: u32 = 0x8000_0000;
        options.share_mode(0).custom_flags(FILE_FLAG_WRITE_THROUGH);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// `File.Move(source, destination)`: refuses an existing destination.
pub fn move_file_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_COPY_ALLOWED};
        let (s, d) = (wide(source), wide(destination));
        if unsafe { MoveFileExW(s.as_ptr(), d.as_ptr(), MOVEFILE_COPY_ALLOWED) } == 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        // .NET on Unix: link, then unlink the source, so an existing destination fails.
        std::fs::hard_link(source, destination)?;
        std::fs::remove_file(source)
    }
}

/// `Directory.Move(source, destination)`: refuses an existing destination.
pub fn move_directory(source: &Path, destination: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(destination).is_ok() {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, format!("Cannot create '{}' because a file or directory with the same name already exists.", destination.display())));
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
        let (s, d) = (wide(source), wide(destination));
        if unsafe { MoveFileExW(s.as_ptr(), d.as_ptr(), 0) } == 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))]
    { std::fs::rename(source, destination) }
}

/// `File.Replace(source, destination, null)`: the destination must exist and is replaced by the
/// source, keeping the destination's identity (ReplaceFileW).
pub fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
        let (s, d) = (wide(source), wide(destination));
        let ok = unsafe { ReplaceFileW(d.as_ptr(), s.as_ptr(), std::ptr::null(), 0, std::ptr::null(), std::ptr::null()) };
        if ok == 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if !destination.is_file() { return Err(io::Error::new(io::ErrorKind::NotFound, format!("Could not find file '{}'.", destination.display()))); }
        std::fs::rename(source, destination)
    }
}

/// `File.Open(path, OpenOrCreate, ReadWrite, FileShare.None)`: an exclusive lock held while the
/// returned file stays open. .NET on Unix takes `flock(LOCK_EX | LOCK_NB)` for FileShare.None.
pub fn open_exclusive(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(file)
}

/// `File.Open(path, OpenOrCreate, ReadWrite, FileShare.ReadWrite)`: the data-root hold.
pub fn open_shared(path: &Path) -> io::Result<File> {
    OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)
}

/// True when the entry itself (never a link's target) is a link or junction:
/// `[IO.File]::GetAttributes` has `ReparsePoint`.
pub fn is_reparse_point(path: &Path) -> io::Result<Option<bool>> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
                Ok(Some(meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0))
            }
            #[cfg(not(windows))]
            { Ok(Some(meta.file_type().is_symlink())) }
        }
        Err(e) if matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => Ok(None),
        Err(e) => Err(e),
    }
}

/// The names (without `.exe`) of running processes, as `Get-Process` reports `ProcessName`.
#[cfg(windows)]
pub fn process_names() -> io::Result<Vec<String>> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
    let mut names = Vec::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
    while ok != 0 {
        let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
        let stem = if name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".exe") { name[..name.len() - 4].to_string() } else { name };
        names.push(stem);
        ok = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    unsafe { CloseHandle(snapshot) };
    Ok(names)
}

/// The path for a Win32 call, in the `\\?\` form that lifts the 260-character limit, as .NET
/// does for its own calls (a backup path under a long profile folder passes 260 easily). The
/// engine's paths are already full and normalized, which that form requires.
#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    let text = path.to_string_lossy();
    let long = if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
        text.into_owned()
    } else if let Some(unc) = text.strip_prefix(r"\\") {
        format!(r"\\?\UNC\{unc}")
    } else if text.as_bytes().get(1) == Some(&b':') {
        format!(r"\\?\{text}")
    } else {
        text.into_owned()
    };
    long.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A registry hive `Get-ItemProperty` reads from.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub enum Hive { CurrentUser, LocalMachine }

/// A string value (`REG_SZ` or expanded `REG_EXPAND_SZ`), as `Get-ItemProperty` returns it, or
/// `None` when the key or value is missing or is not a string.
#[cfg(windows)]
pub fn registry_string(hive: Hive, key: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    let root = match hive { Hive::CurrentUser => HKEY_CURRENT_USER, Hive::LocalMachine => HKEY_LOCAL_MACHINE };
    let key_w: Vec<u16> = key.encode_utf16().chain(std::iter::once(0)).collect();
    let name_w: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut size: u32 = 0;
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
    if unsafe { RegGetValueW(root, key_w.as_ptr(), name_w.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) } != 0 { return None; }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2) + 1];
    let mut size = (buffer.len() * 2) as u32;
    if unsafe { RegGetValueW(root, key_w.as_ptr(), name_w.as_ptr(), flags, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut size) } != 0 { return None; }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

/// The file system drives PowerShell lists (`Get-PSDrive -PSProvider FileSystem`): every drive
/// letter, and PowerShell's own `Temp:` drive, in name order.
#[cfg(windows)]
pub fn drive_roots() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::GetLogicalDrives;
    let mask = unsafe { GetLogicalDrives() };
    let mut drives: Vec<(String, String)> = (0..26u8).filter(|i| mask & (1 << i) != 0).map(|i| { let letter = (b'A' + i) as char; (letter.to_string(), format!("{letter}:\\")) }).collect();
    drives.push(("Temp".to_string(), std::env::temp_dir().to_string_lossy().into_owned()));
    drives.sort_by(|a, b| a.0.to_ascii_uppercase().cmp(&b.0.to_ascii_uppercase()));
    drives.into_iter().map(|(_, root)| root).collect()
}
