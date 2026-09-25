use std::{
    io,
    os::windows::ffi::OsStrExt,
    sync::{mpsc, OnceLock},
};

use winreg::{enums::*, RegKey, RegValue};

const ES_CONTINUOUS: u32 = 0x8000_0000;
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

/// Holds the system awake while alive.
pub struct SleepGuard {
    active: bool,
}

impl SleepGuard {
    pub fn acquire() -> Self {
        if is_supported() {
            set_keep_awake(true);
            return SleepGuard { active: true };
        }
        SleepGuard { active: false }
    }

    pub fn release(&mut self) {
        if self.active {
            set_keep_awake(false);
            self.active = false;
        }
    }
}

/// SetThreadExecutionState is per-thread and async tasks hop between worker
/// threads, so one long-lived thread owns the keep-awake request.
fn set_keep_awake(on: bool) {
    static TX: OnceLock<mpsc::Sender<bool>> = OnceLock::new();
    let tx = TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<bool>();
        std::thread::spawn(move || {
            for on in rx {
                let flags = if on {
                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED
                } else {
                    ES_CONTINUOUS
                };
                unsafe {
                    windows_sys::Win32::System::Power::SetThreadExecutionState(flags);
                }
            }
        });
        tx
    });
    let _ = tx.send(on);
}

impl Drop for SleepGuard {
    fn drop(&mut self) {
        self.release();
    }
}

fn is_supported() -> bool {
    cfg!(target_os = "windows")
}

/// Modal error box that works before the event loop starts.
pub fn show_fatal_error(title: &str, message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (title, message) = (wide(title), wide(message));
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

pub fn disk_free_bytes(path: &std::path::Path) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = std::ffi::OsStr::encode_wide(path.as_os_str())
        .chain(Some(0))
        .collect();
    let mut free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut free,
        )
    };
    if ok != 0 {
        Some(free)
    } else {
        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AssociationState {
    Missing,
    TorrentFlow,
    Other,
}

const TORRENT_VALUES: [(&str, &str); 3] = [
    (r"Software\Classes\.torrent", ""),
    (r"Software\Classes\TorrentFlow.torrent", ""),
    (
        r"Software\Classes\TorrentFlow.torrent\shell\open\command",
        "",
    ),
];
const MAGNET_VALUES: [(&str, &str); 3] = [
    (r"Software\Classes\magnet", ""),
    (r"Software\Classes\magnet", "URL Protocol"),
    (r"Software\Classes\magnet\shell\open\command", ""),
];

pub struct FileAssociationBackup {
    kind: &'static str,
    values: Vec<(&'static str, &'static str, Option<RegValue>)>,
}

fn command_executable(command: &str) -> Option<&str> {
    let quoted = command.trim().strip_prefix('"')?;
    let (exe, args) = quoted.split_once('"')?;
    if args.trim() != "\"%1\"" {
        return None;
    }
    Some(exe)
}

fn command_is_torrentflow(command: &str) -> bool {
    command_executable(command)
        .and_then(|exe| std::path::Path::new(exe).file_name())
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("torrentflow.exe"))
}

fn read_string_value(hkcu: &RegKey, path: &str, name: &str) -> anyhow::Result<Option<String>> {
    let key = match hkcu.open_subkey(path) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    match key.get_value::<String, _>(name) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_raw_value(hkcu: &RegKey, path: &str, name: &str) -> anyhow::Result<Option<RegValue>> {
    let key = match hkcu.open_subkey(path) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    match key.get_raw_value(name) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_default_value(hkcu: &RegKey, path: &str) -> anyhow::Result<Option<String>> {
    read_string_value(hkcu, path, "")
}

fn ignore_missing(result: io::Result<()>) -> anyhow::Result<()> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn delete_matching_value(
    hkcu: &RegKey,
    path: &str,
    name: &str,
    expected: &str,
) -> anyhow::Result<bool> {
    let key = match hkcu.open_subkey_with_flags(path, KEY_READ | KEY_WRITE) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    match key.get_value::<String, _>(name) {
        Ok(value) if value.eq_ignore_ascii_case(expected) => {
            ignore_missing(key.delete_value(name))?;
            Ok(true)
        }
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn delete_subkey_if_empty(hkcu: &RegKey, path: &str) -> anyhow::Result<()> {
    let key = match hkcu.open_subkey_with_flags(path, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if key.enum_keys().next().transpose()?.is_some()
        || key.enum_values().next().transpose()?.is_some()
    {
        return Ok(());
    }
    drop(key);
    ignore_missing(hkcu.delete_subkey(path))
}

pub fn snapshot_file_association(kind: &str) -> anyhow::Result<FileAssociationBackup> {
    let (kind, locations) = match kind {
        "torrent" => ("torrent", TORRENT_VALUES.as_slice()),
        "magnet" => ("magnet", MAGNET_VALUES.as_slice()),
        _ => anyhow::bail!("unknown association kind"),
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let values = locations
        .iter()
        .map(|&(path, name)| Ok((path, name, read_raw_value(&hkcu, path, name)?)))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(FileAssociationBackup { kind, values })
}

pub fn restore_file_association(backup: &FileAssociationBackup) -> anyhow::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for (path, name, value) in &backup.values {
        match value {
            Some(value) => {
                let (key, _) = hkcu.create_subkey(path)?;
                key.set_raw_value(name, value)?;
            }
            None => match hkcu.open_subkey_with_flags(path, KEY_WRITE) {
                Ok(key) => ignore_missing(key.delete_value(name))?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            },
        }
    }
    let cleanup: &[&str] = match backup.kind {
        "torrent" => &[
            r"Software\Classes\TorrentFlow.torrent\shell\open\command",
            r"Software\Classes\TorrentFlow.torrent\shell\open",
            r"Software\Classes\TorrentFlow.torrent\shell",
            r"Software\Classes\TorrentFlow.torrent",
        ],
        "magnet" => &[
            r"Software\Classes\magnet\shell\open\command",
            r"Software\Classes\magnet\shell\open",
            r"Software\Classes\magnet\shell",
        ],
        _ => anyhow::bail!("unknown association kind"),
    };
    for path in cleanup {
        delete_subkey_if_empty(&hkcu, path)?;
    }
    Ok(())
}

fn association_targets_exe(hkcu: &RegKey, kind: &str, exe: &str) -> anyhow::Result<bool> {
    let path = match kind {
        "torrent" => r"Software\Classes\TorrentFlow.torrent\shell\open\command",
        "magnet" => r"Software\Classes\magnet\shell\open\command",
        _ => anyhow::bail!("unknown association kind"),
    };
    Ok(read_default_value(hkcu, path)?
        .and_then(|command| command_executable(&command).map(str::to_owned))
        .is_some_and(|target| target.eq_ignore_ascii_case(exe)))
}

fn association_state(hkcu: &RegKey, kind: &str) -> anyhow::Result<AssociationState> {
    match kind {
        "torrent" => Ok(read_default_value(hkcu, r"Software\Classes\.torrent")?
            .map(|value| {
                if value.eq_ignore_ascii_case("TorrentFlow.torrent") {
                    AssociationState::TorrentFlow
                } else {
                    AssociationState::Other
                }
            })
            .unwrap_or(AssociationState::Missing)),
        "magnet" => Ok(
            read_default_value(hkcu, r"Software\Classes\magnet\shell\open\command")?
                .map(|command| {
                    if command_is_torrentflow(&command) {
                        AssociationState::TorrentFlow
                    } else {
                        AssociationState::Other
                    }
                })
                .unwrap_or(AssociationState::Missing),
        ),
        _ => anyhow::bail!("unknown association kind"),
    }
}

fn register_file_association(hkcu: &RegKey, kind: &str, exe: &str) -> anyhow::Result<()> {
    match kind {
        "torrent" => {
            let (key, _) = hkcu.create_subkey(r"Software\Classes\.torrent")?;
            key.set_value("", &"TorrentFlow.torrent")?;
            let (cls, _) = hkcu.create_subkey(r"Software\Classes\TorrentFlow.torrent")?;
            cls.set_value("", &"Torrent File")?;
            let (cmd, _) =
                hkcu.create_subkey(r"Software\Classes\TorrentFlow.torrent\shell\open\command")?;
            cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;
        }
        "magnet" => {
            let (key, _) = hkcu.create_subkey(r"Software\Classes\magnet")?;
            key.set_value("", &"URL:Magnet Protocol")?;
            key.set_value("URL Protocol", &"")?;
            let (cmd, _) = hkcu.create_subkey(r"Software\Classes\magnet\shell\open\command")?;
            cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;
        }
        _ => anyhow::bail!("unknown association kind"),
    }
    Ok(())
}

fn remove_file_association(hkcu: &RegKey, kind: &str, exe: &str) -> anyhow::Result<()> {
    if association_state(hkcu, kind)? != AssociationState::TorrentFlow
        || !association_targets_exe(hkcu, kind, exe)?
    {
        return Ok(());
    }
    match kind {
        "torrent" => {
            delete_matching_value(
                hkcu,
                r"Software\Classes\.torrent",
                "",
                "TorrentFlow.torrent",
            )?;
            delete_matching_value(
                hkcu,
                r"Software\Classes\TorrentFlow.torrent\shell\open\command",
                "",
                &format!("\"{exe}\" \"%1\""),
            )?;
            delete_matching_value(
                hkcu,
                r"Software\Classes\TorrentFlow.torrent",
                "",
                "Torrent File",
            )?;
            for path in [
                r"Software\Classes\TorrentFlow.torrent\shell\open\command",
                r"Software\Classes\TorrentFlow.torrent\shell\open",
                r"Software\Classes\TorrentFlow.torrent\shell",
                r"Software\Classes\TorrentFlow.torrent",
            ] {
                delete_subkey_if_empty(hkcu, path)?;
            }
        }
        "magnet" => {
            delete_matching_value(
                hkcu,
                r"Software\Classes\magnet\shell\open\command",
                "",
                &format!("\"{exe}\" \"%1\""),
            )?;
            delete_subkey_if_empty(hkcu, r"Software\Classes\magnet\shell\open\command")?;
            delete_subkey_if_empty(hkcu, r"Software\Classes\magnet\shell\open")?;
            delete_subkey_if_empty(hkcu, r"Software\Classes\magnet\shell")?;
            if delete_matching_value(hkcu, r"Software\Classes\magnet", "", "URL:Magnet Protocol")? {
                delete_matching_value(hkcu, r"Software\Classes\magnet", "URL Protocol", "")?;
            }
        }
        _ => anyhow::bail!("unknown association kind"),
    }
    Ok(())
}

pub fn set_file_association(kind: &str, enable: bool, exe: &str) -> anyhow::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if enable {
        register_file_association(&hkcu, kind, exe)
    } else {
        remove_file_association(&hkcu, kind, exe)
    }
}

pub fn ensure_file_association(kind: &str, exe: &str) -> anyhow::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match association_state(&hkcu, kind)? {
        AssociationState::Missing | AssociationState::TorrentFlow => {
            let backup = snapshot_file_association(kind)?;
            match register_file_association(&hkcu, kind, exe) {
                Ok(()) => Ok(()),
                Err(error) => match restore_file_association(&backup) {
                    Ok(()) => Err(error),
                    Err(rollback_error) => anyhow::bail!(
                        "{error:#}; failed to restore prior association: {rollback_error:#}"
                    ),
                },
            }
        }
        AssociationState::Other => Ok(()),
    }
}

pub fn remove_owned_file_association(kind: &str) -> anyhow::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = match kind {
        "torrent" => r"Software\Classes\TorrentFlow.torrent\shell\open\command",
        "magnet" => r"Software\Classes\magnet\shell\open\command",
        _ => anyhow::bail!("unknown association kind"),
    };
    let Some(command) = read_default_value(&hkcu, path)? else {
        return Ok(());
    };
    if !command_is_torrentflow(&command) {
        return Ok(());
    }
    let Some(exe) = command_executable(&command) else {
        return Ok(());
    };
    let backup = snapshot_file_association(kind)?;
    match remove_file_association(&hkcu, kind, exe) {
        Ok(()) => Ok(()),
        Err(error) => match restore_file_association(&backup) {
            Ok(()) => Err(error),
            Err(rollback_error) => {
                anyhow::bail!("{error:#}; failed to restore prior association: {rollback_error:#}")
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{command_executable, command_is_torrentflow};

    #[test]
    fn recognizes_only_torrentflow_open_commands() {
        assert!(command_is_torrentflow(
            r#""C:\Program Files\TorrentFlow\torrentflow.exe" "%1""#
        ));
        assert!(command_is_torrentflow(
            r#""C:\TorrentFlow\TORRENTFLOW.EXE" "%1""#
        ));
        assert!(!command_is_torrentflow(
            r#""C:\Program Files\Other\client.exe" "%1""#
        ));
        assert!(!command_is_torrentflow(
            r#""C:\TorrentFlow\torrentflow.exe" --extra "%1""#
        ));
        assert_eq!(
            command_executable(r#""C:\TorrentFlow\torrentflow.exe" "%1""#),
            Some(r"C:\TorrentFlow\torrentflow.exe")
        );
    }
}
