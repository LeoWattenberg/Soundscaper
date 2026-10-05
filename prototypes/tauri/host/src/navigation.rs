// SPDX-License-Identifier: AGPL-3.0-only

pub fn allows_editor_navigation(scheme: &str, host: Option<&str>, path: &str) -> bool {
    let local = (scheme == "tauri" && host == Some("localhost"))
        || (["http", "https"].contains(&scheme) && host == Some("tauri.localhost"));
    local && ["", "/", "/index.html"].contains(&path)
}

#[cfg(test)]
mod tests {
    use super::allows_editor_navigation;

    #[test]
    fn tauri_index_html_uses_the_base_origin_with_an_empty_path() {
        // WebviewUrl::App("index.html") is simplified to tauri://localhost.
        assert!(allows_editor_navigation("tauri", Some("localhost"), ""));
    }

    #[test]
    fn platform_origins_allow_only_the_editor_document() {
        for (scheme, host) in [
            ("tauri", "localhost"),
            ("http", "tauri.localhost"),
            ("https", "tauri.localhost"),
        ] {
            for path in ["/", "/index.html"] {
                assert!(allows_editor_navigation(scheme, Some(host), path));
            }
            for path in ["/en/", "/assets/main.js", "/privacy", "/index.html/other"] {
                assert!(!allows_editor_navigation(scheme, Some(host), path));
            }
        }
    }

    #[test]
    fn external_origins_and_missing_hosts_are_rejected() {
        for (scheme, host) in [
            ("https", Some("example.com")),
            ("http", Some("localhost")),
            ("tauri", Some("tauri.localhost")),
            ("tauri", Some("localhost.example.com")),
            ("file", Some("localhost")),
            ("data", None),
            ("javascript", None),
            ("tauri", None),
        ] {
            for path in ["", "/", "/index.html"] {
                assert!(!allows_editor_navigation(scheme, host, path));
            }
        }
    }
}
