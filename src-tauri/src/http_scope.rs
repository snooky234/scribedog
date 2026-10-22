//! The http scope in `capabilities/default.json`, evaluated by the engine the
//! shell itself uses.
//!
//! tauri-plugin-http matches a request against these entries with the
//! `urlpattern` crate. That is not the URLPattern a browser (or Node) ships:
//! the crate runs fixed text in a host name through the URL host parser, so a
//! literal `192.168.` becomes the IPv4 address `192.0.0.168` and the entry
//! never matches anything. A check in the frontend cannot see that, the shell
//! answers "url not allowed on the configured scope" instead. Only text inside
//! a regex group is left alone, which is why the private ranges are written as
//! one group each.

use url::Url;
use urlpattern::{UrlPattern, UrlPatternInit, UrlPatternMatchInput};

/// The plugin's own parsing (its `scope.rs` keeps it private): search, hash and
/// an empty path default to a wildcard.
fn parse_url_pattern(pattern: &str) -> UrlPattern {
    let mut init = UrlPatternInit::parse_constructor_string::<regex::Regex>(pattern, None)
        .unwrap_or_else(|error| panic!("`{pattern}` does not parse: {error}"));

    if init.search.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.search.replace("*".to_string());
    }

    if init.hash.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.hash.replace("*".to_string());
    }

    if init.pathname.as_ref().map(|p| p.is_empty() || p == "/").unwrap_or(true) {
        init.pathname.replace("*".to_string());
    }

    UrlPattern::parse(init, Default::default()).unwrap_or_else(|error| panic!("`{pattern}` is no URL pattern: {error}"))
}

fn http_scope() -> Vec<UrlPattern> {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json")).expect("default.json is valid JSON");

    capability["permissions"]
        .as_array()
        .expect("permissions is a list")
        .iter()
        .find(|permission| permission["identifier"] == "http:default")
        .expect("default.json grants http:default")["allow"]
        .as_array()
        .expect("http:default has an allow list")
        .iter()
        .map(|entry| parse_url_pattern(entry["url"].as_str().expect("an allow entry has a url")))
        .collect()
}

fn is_allowed(scope: &[UrlPattern], url: &str) -> bool {
    let url = Url::parse(url).expect("a test url");

    scope
        .iter()
        .any(|pattern| pattern.test(UrlPatternMatchInput::Url(url.clone())).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lets_through_every_address_the_endpoint_check_accepts() {
        let scope = http_scope();

        for url in [
            "http://localhost:1337/v1/models",
            "http://127.0.0.1:11434/api/chat",
            "http://10.1.2.3:11434/api/tags",
            "http://172.16.0.9:1234/v1/models",
            "http://172.31.255.1:1234/v1/models",
            "http://192.168.1.50:1337/v1/chat/completions",
            "http://192.168.1.50:11434/api/tags",
            "http://jan.fritz.box:1337/v1/models",
            "http://ollama.local:11434/api/tags",
            "http://gpu.lan:1234/v1/models",
            "http://llm.home.arpa/v1/models",
            "http://models.corp.internal:8080/v1/models",
            "https://api.openai.com/v1/models",
        ] {
            assert!(is_allowed(&scope, url), "{url} should be inside the scope");
        }
    }

    #[test]
    fn refuses_public_addresses_over_plain_http() {
        let scope = http_scope();

        for url in [
            "http://8.8.8.8/v1",
            "http://172.32.0.1/v1",
            "http://192.169.0.1/v1",
            "http://192.168.1.1.evil.com/v1",
            "http://10.1.2.3.evil.com/v1",
            "http://evil.com/v1",
            "http://169.254.169.254/latest/meta-data",
        ] {
            assert!(!is_allowed(&scope, url), "{url} should be outside the scope");
        }
    }
}
