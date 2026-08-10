use serde_json::{json, Value};
use std::{collections::HashMap, env, fs, path::PathBuf};

const ENV_FILES: [&str; 2] = [".env.local", ".env"];
const CLIENT_ID_NAMES: [&str; 4] = [
    "KLARKEY_AVE_CLIENT_ID",
    "AVE_CLIENT_ID",
    "VITE_KLARKEY_AVE_CLIENT_ID",
    "VITE_AVE_CLIENT_ID",
];
const CONVEX_URL_NAMES: [&str; 4] = [
    "KLARKEY_CONVEX_URL",
    "CONVEX_URL",
    "VITE_KLARKEY_CONVEX_URL",
    "VITE_CONVEX_URL",
];

pub(crate) fn sync_config() -> Value {
    let mut values = read_env_files();
    for (key, value) in env::vars() {
        values.insert(key, value);
    }

    json!({
        "clientId": first_value(&values, &CLIENT_ID_NAMES),
        "convexUrl": first_value(&values, &CONVEX_URL_NAMES),
        "issuer": "https://aveid.net",
        "redirectUri": "klarkey://oauth/callback"
    })
}

fn read_env_files() -> HashMap<String, String> {
    let mut values = HashMap::new();
    for root in env_roots() {
        for file in ENV_FILES {
            read_env_file(root.join(file), &mut values);
        }
    }
    values
}

fn env_roots() -> Vec<PathBuf> {
    env::current_dir().into_iter().collect()
}

fn read_env_file(path: PathBuf, values: &mut HashMap<String, String>) {
    let Ok(contents) = fs::read_to_string(path) else {
        return;
    };
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let assignment = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
        let Some((name, value)) = assignment.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if is_env_name(name) && !values.contains_key(name) {
            values.insert(name.to_string(), trim_env_value(value));
        }
    }
}

fn trim_env_value(value: &str) -> String {
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(trimmed);
    unquoted
        .find(" #")
        .map(|index| unquoted[..index].trim_end())
        .unwrap_or(unquoted)
        .to_string()
}

fn is_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first.is_ascii_alphabetic())
        && chars.all(|char| char == '_' || char.is_ascii_alphanumeric())
}

fn first_value(values: &HashMap<String, String>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .filter_map(|name| values.get(*name))
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .map(ToString::to_string)
}
