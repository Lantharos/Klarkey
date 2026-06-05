use crate::native_host_item_fields::{
    array_strings, find_item, new_id, normalize_host, site_origin, string_field,
};
use crate::native_host_webauthn_crypto::{normalize_credential_id, resolve_rp_id};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const PENDING_TTL_MS: u128 = 10 * 60 * 1000;

pub(crate) fn site_passkeys(state: Option<&Value>) -> &[Value] {
    state
        .and_then(|state| state.get("sitePasskeys"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn pending_passkeys(state: Option<&Value>) -> &[Value] {
    state
        .and_then(|state| state.get("pendingPasskeys"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub(crate) fn known_credential_ids(state: Option<&Value>) -> Vec<String> {
    site_passkeys(state)
        .iter()
        .chain(pending_passkeys(state).iter())
        .filter_map(|passkey| string_field(passkey, "credentialId").map(ToString::to_string))
        .collect()
}

pub(crate) fn save_site_passkey(state: &mut Value, pending: &Value, item_id: &str, url: &str) {
    let credential_id = string_field(pending, "credentialId")
        .unwrap_or_default()
        .to_string();
    let passkey_id = find_site_passkey(state, &credential_id)
        .and_then(|passkey| string_field(passkey, "id"))
        .map(ToString::to_string)
        .unwrap_or_else(|| new_id("passkey"));
    let record = json!({
        "id": passkey_id,
        "itemId": item_id,
        "label": string_field(pending, "label").unwrap_or("Saved passkey"),
        "credentialId": credential_id,
        "rpId": string_field(pending, "rpId"),
        "userName": string_field(pending, "userName"),
        "userHandle": string_field(pending, "userHandle"),
        "transports": array_strings(pending, "transports"),
        "privateKeyJwk": pending.get("privateKeyJwk").cloned().unwrap_or_else(|| json!({})),
        "signCount": 0,
        "createdAt": string_field(pending, "createdAt").unwrap_or_default(),
        "lastUsedAt": now_ms().to_string()
    });

    let site_passkeys = ensure_array(state, "sitePasskeys");
    if let Some(index) = site_passkeys
        .iter()
        .position(|passkey| string_field(passkey, "credentialId") == Some(credential_id.as_str()))
    {
        site_passkeys[index] = record;
    } else {
        site_passkeys.push(record);
    }

    update_item_passkey_summary(state, item_id, &passkey_id, &credential_id, url);
}

fn update_item_passkey_summary(
    state: &mut Value,
    item_id: &str,
    passkey_id: &str,
    credential_id: &str,
    url: &str,
) {
    let Some(item) = ensure_array(state, "items")
        .iter_mut()
        .find(|item| string_field(item, "itemId") == Some(item_id))
    else {
        return;
    };

    if !item.get("websites").is_some_and(Value::is_array) {
        item["websites"] = json!([]);
    }
    let origin = site_origin(url).unwrap_or_else(|| url.to_string());
    let websites = item
        .get_mut("websites")
        .and_then(Value::as_array_mut)
        .expect("websites array");
    if !websites
        .iter()
        .any(|site| site.as_str() == Some(origin.as_str()))
    {
        websites.push(json!(origin));
    }

    item["passkeys"] = json!([{
        "id": passkey_id,
        "label": string_field(item, "itemName").unwrap_or("Saved passkey"),
        "credentialId": credential_id,
        "rpId": normalize_host(url),
        "createdAt": now_ms().to_string()
    }]);
    item["updatedAt"] = json!(now_ms().to_string());
}

pub(crate) fn passkey_choices(passkeys: Vec<&Value>) -> Vec<Value> {
    passkeys
        .into_iter()
        .take(20)
        .map(|passkey| {
            json!({
                "credentialId": string_field(passkey, "credentialId").unwrap_or_default(),
                "itemId": string_field(passkey, "itemId").unwrap_or_default(),
                "itemName": string_field(passkey, "label").unwrap_or("Saved passkey"),
                "userName": string_field(passkey, "userName"),
                "rpId": string_field(passkey, "rpId"),
                "lastUsedAt": string_field(passkey, "lastUsedAt")
            })
        })
        .collect()
}

pub(crate) fn usable_passkeys<'a>(
    state: Option<&'a Value>,
    url: &str,
    request_json: &str,
) -> Vec<&'a Value> {
    usable_passkey_records(site_passkeys(state), state, url, request_json, true)
}

pub(crate) fn usable_passkey_records<'a>(
    passkeys: &'a [Value],
    state: Option<&'a Value>,
    url: &str,
    request_json: &str,
    require_linked_item: bool,
) -> Vec<&'a Value> {
    let request = match parse_json(request_json) {
        Ok(request) => request,
        Err(_) => return Vec::new(),
    };
    let origin = site_origin(url).unwrap_or_else(|| url.to_string());
    let rp_id = match resolve_rp_id(&origin, request.get("rpId").and_then(Value::as_str)) {
        Ok(rp_id) => rp_id,
        Err(_) => return Vec::new(),
    };
    let requested_ids = request
        .get("allowCredentials")
        .and_then(Value::as_array)
        .map(|credentials| {
            credentials
                .iter()
                .filter_map(|credential| credential.get("id").and_then(Value::as_str))
                .filter_map(|id| normalize_credential_id(id).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    passkeys
        .iter()
        .filter(|passkey| {
            let Some(credential_id) = string_field(passkey, "credentialId") else {
                return false;
            };
            string_field(passkey, "rpId") == Some(rp_id.as_str())
                && (requested_ids.is_empty() || requested_ids.iter().any(|id| id == credential_id))
                && (!require_linked_item
                    || string_field(passkey, "itemId")
                        .and_then(|item_id| find_item(state, item_id))
                        .is_some())
        })
        .collect()
}

pub(crate) fn parse_json(value: &str) -> Result<Value, String> {
    serde_json::from_str(value).map_err(|_| String::from("The passkey request was invalid."))
}

pub(crate) fn find_pending_passkey<'a>(state: &'a Value, pending_id: &str) -> Option<&'a Value> {
    pending_passkeys(Some(state))
        .iter()
        .find(|passkey| string_field(passkey, "id") == Some(pending_id))
}

fn find_site_passkey<'a>(state: &'a Value, credential_id: &str) -> Option<&'a Value> {
    site_passkeys(Some(state))
        .iter()
        .find(|passkey| string_field(passkey, "credentialId") == Some(credential_id))
}

pub(crate) fn remove_pending_passkey(state: &mut Value, pending_id: &str) -> bool {
    let pending = ensure_array(state, "pendingPasskeys");
    let initial_len = pending.len();
    pending.retain(|passkey| string_field(passkey, "id") != Some(pending_id));
    pending.len() != initial_len
}

pub(crate) fn prune_pending_passkeys(state: &mut Value) {
    let cutoff = now_ms().saturating_sub(PENDING_TTL_MS);
    ensure_array(state, "pendingPasskeys").retain(|passkey| {
        string_field(passkey, "createdAt")
            .and_then(|value| value.parse::<u128>().ok())
            .is_some_and(|created_at| created_at >= cutoff)
    });
}

pub(crate) fn touch_passkey(state: &mut Value, credential_id: &str, sign_count: u64) {
    let now = now_ms().to_string();
    if let Some(passkey) = ensure_array(state, "sitePasskeys")
        .iter_mut()
        .find(|passkey| string_field(passkey, "credentialId") == Some(credential_id))
    {
        passkey["signCount"] = json!(sign_count);
        passkey["lastUsedAt"] = json!(now);
    }
}

pub(crate) fn ensure_array<'a>(state: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !state.get(key).is_some_and(Value::is_array) {
        state[key] = json!([]);
    }
    state
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .expect("state array")
}

pub(crate) fn error_result(title: impl Into<String>, message: impl Into<String>) -> Value {
    json!({
        "status": "error",
        "title": title.into(),
        "message": message.into()
    })
}

pub(crate) fn is_account_match(left: Option<&str>, right: &str) -> bool {
    left.is_some_and(|left| left.trim().eq_ignore_ascii_case(right.trim()))
}

pub(crate) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
