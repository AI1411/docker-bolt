pub fn core_version() -> &'static str {
    "0.1.0"
}

#[cfg(test)]
mod tests {
    use super::core_version;

    #[test]
    fn core_version_is_semver_prefix() {
        assert!(core_version().starts_with("0.1."));
    }
}
