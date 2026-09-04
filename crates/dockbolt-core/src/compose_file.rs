use std::path::Path;

pub fn is_compose_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()),
        Some(ext) if ext == "yml" || ext == "yaml"
    )
}

pub fn sanitize_project_name(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "dockbolt".into()
    } else {
        trimmed.to_string()
    }
}

pub fn compose_name_from_yaml(contents: &str) -> Option<String> {
    for line in contents.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(rest) = trimmed.strip_prefix("name:") else {
            continue;
        };
        let value = rest.trim().trim_matches('"').trim_matches('\'').trim();
        if !value.is_empty() {
            return Some(sanitize_project_name(value));
        }
    }
    None
}

pub fn compose_project_name(file: &Path, contents: &str) -> String {
    if let Some(name) = compose_name_from_yaml(contents) {
        return name;
    }
    let dir = file
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("dockbolt");
    sanitize_project_name(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn yaml_name_wins_over_directory() {
        let path = Path::new("/tmp/my-app/compose.yml");
        assert_eq!(
            compose_project_name(
                path,
                "name: Shop Front\nservices:\n  web:\n    image: nginx\n"
            ),
            "shop_front"
        );
    }

    #[test]
    fn directory_name_when_yaml_has_no_name() {
        let path = Path::new("/tmp/Billing API/docker-compose.yaml");
        assert_eq!(
            compose_project_name(path, "services:\n  db:\n    image: postgres\n"),
            "billing_api"
        );
        assert!(is_compose_path(path));
        assert!(!is_compose_path(Path::new("/tmp/compose.txt")));
    }

    #[test]
    fn sanitize_falls_back_when_empty() {
        assert_eq!(sanitize_project_name("!!!"), "dockbolt");
    }

    #[test]
    fn yaml_name_skips_comments_and_indented_keys() {
        let yaml = "# name: ignored\n  name: nested\nname: \"Web App\"\n";
        assert_eq!(compose_name_from_yaml(yaml).as_deref(), Some("web_app"));
    }
}
