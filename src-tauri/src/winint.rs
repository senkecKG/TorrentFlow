use std::os::windows::ffi::OsStrExt;

const ES_CONTINUOUS: u32 = 0x8000_0000;
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

/// Holds the system awake while alive.
pub struct SleepGuard {
    active: bool,
}

impl SleepGuard {
    pub fn acquire() -> Self {
        if is_supported() {
            unsafe {
                windows_sys::Win32::System::Power::SetThreadExecutionState(
                    ES_CONTINUOUS | ES_SYSTEM_REQUIRED,
                );
            }
            return SleepGuard { active: true };
        }
        SleepGuard { active: false }
    }

    pub fn release(&mut self) {
        if self.active {
            unsafe {
                windows_sys::Win32::System::Power::SetThreadExecutionState(ES_CONTINUOUS);
            }
            self.active = false;
        }
    }
}

impl Drop for SleepGuard {
    fn drop(&mut self) {
        self.release();
    }
}

fn is_supported() -> bool {
    cfg!(target_os = "windows")
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

pub fn set_file_association(kind: &str, enable: bool, exe: &str) -> anyhow::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match kind {
        "torrent" => {
            let (key, _) = hkcu.create_subkey(r"Software\Classes\.torrent")?;
            key.set_value("", &"TorrentFlow.torrent")?;
            let (cls, _) = hkcu.create_subkey(r"Software\Classes\TorrentFlow.torrent")?;
            cls.set_value("", &"Torrent File")?;
            let (cmd, _) =
                hkcu.create_subkey(r"Software\Classes\TorrentFlow.torrent\shell\open\command")?;
            cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;
            if !enable {
                let _ =
                    hkcu.delete_subkey(r"Software\Classes\TorrentFlow.torrent\shell\open\command");
                let _ = hkcu.delete_subkey(r"Software\Classes\TorrentFlow.torrent\shell\open");
                let _ = hkcu.delete_subkey(r"Software\Classes\TorrentFlow.torrent\shell");
                let _ = hkcu.delete_subkey(r"Software\Classes\TorrentFlow.torrent");
                let _ = hkcu.delete_subkey(r"Software\Classes\.torrent");
            }
        }
        "magnet" => {
            let (key, _) = hkcu.create_subkey(r"Software\Classes\magnet")?;
            if enable {
                key.set_value("", &"URL:Magnet Protocol")?;
                key.set_value("URL Protocol", &"")?;
                let (cmd, _) = hkcu.create_subkey(r"Software\Classes\magnet\shell\open\command")?;
                cmd.set_value("", &format!("\"{}\" \"%1\"", exe))?;
            } else {
                let _ = hkcu.delete_subkey_all(r"Software\Classes\magnet");
            }
        }
        _ => anyhow::bail!("unknown association kind"),
    }
    Ok(())
}
