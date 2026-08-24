use std::path::PathBuf;

const REG_KEYS: &[&str] = &[
    r"SOFTWARE\VideoLAN\VLC",
    r"SOFTWARE\WOW6432Node\VideoLAN\VLC",
];

pub fn detect_vlc(manual_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = manual_path {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    for root in registry_install_paths() {
        if root.is_file() {
            return Some(root);
        }
    }
    for mut p in standard_paths() {
        p.push("VideoLAN");
        p.push("VLC");
        p.push("vlc.exe");
        if p.is_file() {
            return Some(p);
        }
    }
    path_lookup("vlc.exe")
}

fn registry_install_paths() -> Vec<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hk_lm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut out = Vec::new();
    for key in REG_KEYS {
        if let Ok(k) = hk_lm.open_subkey(key) {
            if let Ok(path) = k.get_value::<String, _>("InstallDir") {
                out.push(PathBuf::from(path).join("vlc.exe"));
            }
            if let Ok(path) = k.get_value::<String, _>("") {
                out.push(PathBuf::from(path));
            }
        }
    }
    out
}

fn standard_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        out.push(PathBuf::from(pf));
    }
    if let Some(pf) = std::env::var_os("ProgramFiles(x86)") {
        out.push(PathBuf::from(pf));
    }
    if let Some(lpd) = std::env::var_os("LocalAppData") {
        out.push(PathBuf::from(lpd).join("Programs"));
    }
    out
}

fn path_lookup(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Launch VLC with a URL. Arguments are passed separately, never via a shell.
pub fn launch_vlc(vlc: &std::path::Path, url: &str) -> anyhow::Result<()> {
    std::process::Command::new(vlc)
        .arg(url)
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to start VLC: {e}"))?;
    Ok(())
}
