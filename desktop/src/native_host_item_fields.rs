use serde_json::Value;
use std::net::IpAddr;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn items(state: Option<&Value>) -> &[Value] {
    state
        .and_then(|state| state.get("items"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub(crate) fn string_field<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    item.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

pub(crate) fn array_strings(item: &Value, key: &str) -> Vec<String> {
    item.get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn normalize_host(value: &str) -> Option<String> {
    let mut text = value.trim().to_ascii_lowercase();
    if text.is_empty() {
        return None;
    }

    if let Some(index) = text.find("://") {
        let scheme = &text[..index];
        if scheme != "http" && scheme != "https" {
            return None;
        }
        text = text[index + 3..].to_string();
    }

    let slash_index = text.find('/').unwrap_or(text.len());
    if let Some(at_index) = text[..slash_index].rfind('@') {
        text = text[at_index + 1..].to_string();
    }

    for delimiter in ['/', '?', '#'] {
        if let Some(index) = text.find(delimiter) {
            text.truncate(index);
        }
    }

    if text.starts_with('[') {
        return text.find(']').map(|index| text[..=index].to_string());
    }

    if let Some(index) = text.find(':') {
        text.truncate(index);
    }

    let host = text.trim_matches('.').to_string();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

pub(crate) fn site_origin(value: &str) -> Option<String> {
    let text = value.trim();
    let (scheme, rest) = if let Some(index) = text.find("://") {
        (&text[..index], &text[index + 3..])
    } else {
        ("https", text)
    };
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let mut authority = rest;
    for delimiter in ['/', '?', '#'] {
        if let Some(index) = authority.find(delimiter) {
            authority = &authority[..index];
        }
    }
    if let Some(index) = authority.rfind('@') {
        authority = &authority[index + 1..];
    }
    if authority.is_empty() {
        None
    } else {
        Some(format!("{scheme}://{}", authority.to_ascii_lowercase()))
    }
}

fn host_match_score(saved_site: &str, request_url: &str) -> Option<i32> {
    let saved = normalize_host(saved_site)?;
    let requested = normalize_host(request_url)?;
    if saved == requested {
        return Some(100);
    }
    if subdomain_match_allowed(&saved) && requested.ends_with(&format!(".{saved}")) {
        return Some(80);
    }
    None
}

fn subdomain_match_allowed(candidate: &str) -> bool {
    candidate.contains('.')
        && !candidate.starts_with('[')
        && candidate.parse::<IpAddr>().is_err()
        && psl::suffix_str(candidate).is_some_and(|suffix| suffix != candidate)
}

pub(crate) fn item_site_score(item: &Value, request_url: &str) -> Option<i32> {
    array_strings(item, "websites")
        .iter()
        .filter_map(|site| host_match_score(site, request_url))
        .max()
}

pub(crate) fn find_item<'a>(state: Option<&'a Value>, item_id: &str) -> Option<&'a Value> {
    items(state)
        .iter()
        .find(|item| string_field(item, "itemId") == Some(item_id))
}

pub(crate) fn now_iso_like() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{millis}")
}

pub(crate) fn new_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}_{millis}_{}", process::id())
}
