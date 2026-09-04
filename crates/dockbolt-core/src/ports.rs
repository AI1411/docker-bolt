use crate::types::PublishedPort;

pub fn published_port_label(port: &PublishedPort) -> String {
    if port.host_port == port.container_port {
        port.host_port.to_string()
    } else {
        format!("{}:{}", port.host_port, port.container_port)
    }
}

pub fn summarize_published_ports(ports: &[PublishedPort], max: usize) -> String {
    if ports.is_empty() {
        return "—".into();
    }
    let shown: Vec<String> = ports.iter().take(max).map(published_port_label).collect();
    let extra = ports.len().saturating_sub(max);
    if extra > 0 {
        format!("{} +{}", shown.join(", "), extra)
    } else {
        shown.join(", ")
    }
}

pub fn browser_url_for_port(port: &PublishedPort) -> Option<String> {
    if !port.protocol.eq_ignore_ascii_case("tcp") || port.host_port == 0 {
        return None;
    }
    let scheme = if port.host_port == 443 { "https" } else { "http" };
    let host = match port.host_ip.as_str() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1",
        other => other,
    };
    if host.contains(':') && !host.starts_with('[') {
        return Some(format!("{scheme}://[{host}]:{}", port.host_port));
    }
    Some(format!("{scheme}://{host}:{}", port.host_port))
}

pub fn is_allowed_browser_url(url: &str) -> bool {
    let trimmed = url.trim();
    (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        && !trimmed.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PublishedPort;

    fn tcp(host_ip: &str, host: u16, container: u16) -> PublishedPort {
        PublishedPort {
            host_ip: host_ip.into(),
            host_port: host,
            container_port: container,
            protocol: "tcp".into(),
        }
    }

    #[test]
    fn label_omits_container_port_when_equal() {
        assert_eq!(published_port_label(&tcp("0.0.0.0", 8080, 8080)), "8080");
        assert_eq!(published_port_label(&tcp("0.0.0.0", 8080, 80)), "8080:80");
    }

    #[test]
    fn summarize_shows_two_then_plus_n() {
        let ports = vec![
            tcp("0.0.0.0", 8080, 80),
            tcp("0.0.0.0", 443, 443),
            tcp("0.0.0.0", 9090, 90),
        ];
        assert_eq!(summarize_published_ports(&[], 2), "—");
        assert_eq!(summarize_published_ports(&ports, 2), "8080:80, 443 +1");
    }

    #[test]
    fn browser_url_rewrites_wildcard_and_skips_udp() {
        assert_eq!(
            browser_url_for_port(&tcp("0.0.0.0", 8080, 80)).as_deref(),
            Some("http://127.0.0.1:8080")
        );
        assert_eq!(
            browser_url_for_port(&tcp("::", 443, 443)).as_deref(),
            Some("https://127.0.0.1:443")
        );
        let udp = PublishedPort {
            host_ip: "0.0.0.0".into(),
            host_port: 53,
            container_port: 53,
            protocol: "udp".into(),
        };
        assert_eq!(browser_url_for_port(&udp), None);
        assert!(is_allowed_browser_url("http://127.0.0.1:8080"));
        assert!(!is_allowed_browser_url("file:///etc/passwd"));
        assert!(!is_allowed_browser_url("http://127.0.0.1:80 /x"));
    }
}
