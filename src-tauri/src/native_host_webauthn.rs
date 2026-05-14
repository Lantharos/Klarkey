use crate::native_host_items::{
    array_strings, find_item, item_site_score, list_site_matches, new_id, normalize_host,
    site_origin, string_field,
};
use crate::native_host_webauthn_crypto::{
    create_credential, get_assertion, normalize_credential_id, resolve_rp_id,
};
use serde_json::{json, Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const PENDING_TTL_MS: u128 = 10 * 60 * 1000;

pub(crate) fn passkeys_status(state: Option<&Value>, url: &str, locked: bool) -> Value {
    let host = normalize_host(url).unwrap_or_default();
    let passkeys = site_passkeys(state);
    let available = passkeys.len();
    let exact = passkeys
        .iter()
        .filter(|passkey| string_field(passkey, "rpId") == Some(host.as_str()))
        .count();
    let linked = passkeys
        .iter()
        .filter(|passkey| exact == 0 && passkey_item_matches(state, passkey, url))
        .count();

    let mut result = json!({
        "supported": true,
        "browser": "other",
        "mode": "browser-limited",
        "conditionalUi": false,
        "availablePasskeyCount": available,
        "exactMatchCount": exact,
        "linkedMatchCount": linked,
        "reason": if available == 0 { "Klarkey can create and save passkeys for this site." } else { "Klarkey passkeys are ready for this site." }
    });

    if locked {
        result["status"] = json!("locked");
        result["locked"] = json!(true);
        result["reason"] = json!("Unlock Klarkey to use saved passkeys for this site.");
    }

    result
}

pub(crate) fn plan_passkey_create(state: Option<&Value>, url: &str, request_json: &str) -> Value {
    match build_save_plan(state, url, request_json) {
        Ok(plan) => json!({ "plan": plan }),
        Err(message) => error_result("Passkey unavailable", message),
    }
}

pub(crate) fn create_passkey_credential(
    state: &mut Value,
    origin: &str,
    url: &str,
    request_json: &str,
) -> Value {
    let plan = match build_save_plan(Some(state), url, request_json) {
        Ok(plan) => plan,
        Err(message) => return error_result("Passkey unavailable", message),
    };
    let created = match create_credential(origin, request_json, known_credential_ids(Some(state))) {
        Ok(created) => created,
        Err(message) => return error_result("Passkey unavailable", message),
    };
    let pending_id = new_id("pending_passkey");
    let user_name = plan.get("userName").and_then(Value::as_str);
    let label = plan
        .get("itemName")
        .and_then(Value::as_str)
        .unwrap_or("Saved passkey");

    ensure_array(state, "pendingPasskeys").push(json!({
        "id": pending_id,
        "label": label,
        "credentialId": created.credential_id,
        "rpId": created.rp_id,
        "userName": user_name,
        "userHandle": created.user_handle,
        "transports": ["internal"],
        "privateKeyJwk": created.private_key_jwk,
        "responseJson": created.response_json,
        "createdAt": now_ms().to_string()
    }));

    json!({
        "responseJson": created.response_json,
        "credentialId": created.credential_id,
        "pendingPasskeyId": pending_id
    })
}

pub(crate) fn save_passkey_credential(
    state: &mut Value,
    pending_id: &str,
    url: &str,
    request_json: &str,
    item_id: Option<&str>,
    create_new: bool,
) -> Value {
    prune_pending_passkeys(state);
    let pending = find_pending_passkey(state, pending_id).cloned();
    let Some(pending) = pending else {
        return error_result(
            "Passkey missing",
            "Create the passkey again before saving it.",
        );
    };
    let resolved_item_id =
        match resolve_passkey_item(state, &pending, url, request_json, item_id, create_new) {
            Ok(item_id) => item_id,
            Err(result) => return result,
        };

    save_site_passkey(state, &pending, &resolved_item_id, url);
    remove_pending_passkey(state, pending_id);

    let label = string_field(&pending, "label").unwrap_or("Passkey");
    json!({
        "status": "success",
        "title": "Passkey saved",
        "message": format!("{label} is now linked to this site in Klarkey."),
        "itemId": resolved_item_id
    })
}

pub(crate) fn discard_passkey_credential(state: &mut Value, pending_id: &str) -> Value {
    let removed = remove_pending_passkey(state, pending_id);
    json!({
        "status": if removed { "success" } else { "info" },
        "title": "Passkey cleared",
        "message": if removed { "The pending passkey was removed from Klarkey." } else { "There was no pending passkey left to remove." }
    })
}

pub(crate) fn plan_passkey_get(
    state: Option<&Value>,
    url: &str,
    request_json: &str,
    locked: bool,
) -> Value {
    let choices = usable_passkeys(state, url, request_json)
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
        .collect::<Vec<_>>();
    let mut result = json!({ "choices": choices });
    if locked {
        result["locked"] = json!(true);
    }
    result
}

pub(crate) fn get_passkey_credential(
    state: &mut Value,
    origin: &str,
    url: &str,
    request_json: &str,
    credential_id: &str,
) -> Value {
    let selected = usable_passkeys(Some(state), url, request_json)
        .into_iter()
        .find(|passkey| string_field(passkey, "credentialId") == Some(credential_id))
        .cloned();
    let Some(passkey) = selected else {
        return error_result(
            "Passkey missing",
            "Klarkey does not have a usable passkey for this site yet.",
        );
    };

    let assertion = match get_assertion(origin, request_json, &passkey) {
        Ok(assertion) => assertion,
        Err(message) => return error_result("Passkey unavailable", message),
    };
    touch_passkey(state, credential_id, assertion.sign_count);

    json!({
        "responseJson": assertion.response_json,
        "credentialId": credential_id
    })
}

fn site_passkeys(state: Option<&Value>) -> &[Value] {
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

fn known_credential_ids(state: Option<&Value>) -> Vec<String> {
    site_passkeys(state)
        .iter()
        .chain(pending_passkeys(state).iter())
        .filter_map(|passkey| string_field(passkey, "credentialId").map(ToString::to_string))
        .collect()
}

fn passkey_item_matches(state: Option<&Value>, passkey: &Value, url: &str) -> bool {
    let Some(item_id) = string_field(passkey, "itemId") else {
        return false;
    };
    find_item(state, item_id)
        .and_then(|item| item_site_score(item, url))
        .is_some()
}

fn build_save_plan(state: Option<&Value>, url: &str, request_json: &str) -> Result<Value, String> {
    let request = parse_json(request_json)?;
    let origin = site_origin(url).ok_or_else(|| String::from("The passkey site is invalid."))?;
    let rp_id = resolve_rp_id(&origin, request.pointer("/rp/id").and_then(Value::as_str))?;
    let user_name = request.pointer("/user/name").and_then(Value::as_str);
    let item_name = request
        .pointer("/rp/name")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&rp_id);
    let suggested_match = list_site_matches(state, url)
        .as_array()
        .and_then(|matches| {
            matches.iter().find(|candidate| {
                let Some(item_id) = string_field(candidate, "itemId") else {
                    return false;
                };
                let Some(item) = find_item(state, item_id) else {
                    return false;
                };
                user_name.is_some_and(|name| {
                    is_account_match(string_field(item, "username"), name)
                        || is_account_match(string_field(item, "email"), name)
                })
            })
        })
        .cloned();

    let mut plan = Map::new();
    plan.insert("rpId".into(), json!(rp_id));
    plan.insert("itemName".into(), json!(item_name));
    if let Some(user_name) = user_name {
        plan.insert("userName".into(), json!(user_name));
    }
    if let Some(suggested_match) = suggested_match {
        plan.insert("suggestedMatch".into(), suggested_match);
    }
    Ok(Value::Object(plan))
}

fn resolve_passkey_item(
    state: &mut Value,
    pending: &Value,
    url: &str,
    request_json: &str,
    item_id: Option<&str>,
    create_new: bool,
) -> Result<String, Value> {
    let plan = build_save_plan(Some(state), url, request_json)
        .map_err(|message| error_result("Passkey unavailable", message))?;
    let selected_item = if create_new {
        None
    } else {
        item_id.or_else(|| {
            plan.pointer("/suggestedMatch/itemId")
                .and_then(Value::as_str)
        })
    };

    if let Some(item_id) = selected_item {
        let Some(item) = find_item(Some(state), item_id) else {
            return Err(error_result(
                "Item missing",
                "Klarkey could not find the selected login for this passkey.",
            ));
        };
        if string_field(item, "itemType") != Some("login") {
            return Err(error_result(
                "Item missing",
                "Passkeys can only be linked to login items.",
            ));
        }
        return Ok(item_id.to_string());
    }

    let created_id = new_id("item");
    ensure_array(state, "items").push(json!({
        "itemId": created_id,
        "itemType": "login",
        "itemName": string_field(pending, "label").unwrap_or("Saved passkey"),
        "updatedAt": now_ms().to_string(),
        "username": string_field(pending, "userName").unwrap_or_default(),
        "websites": [site_origin(url).unwrap_or_else(|| url.to_string())],
        "customFields": [],
        "recoveryCodes": [],
        "passkeys": []
    }));
    Ok(created_id)
}

fn save_site_passkey(state: &mut Value, pending: &Value, item_id: &str, url: &str) {
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

fn usable_passkeys<'a>(state: Option<&'a Value>, url: &str, request_json: &str) -> Vec<&'a Value> {
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

    site_passkeys(state)
        .iter()
        .filter(|passkey| {
            let Some(credential_id) = string_field(passkey, "credentialId") else {
                return false;
            };
            string_field(passkey, "rpId") == Some(rp_id.as_str())
                && (requested_ids.is_empty() || requested_ids.iter().any(|id| id == credential_id))
                && string_field(passkey, "itemId")
                    .and_then(|item_id| find_item(state, item_id))
                    .is_some()
        })
        .collect()
}

fn parse_json(value: &str) -> Result<Value, String> {
    serde_json::from_str(value).map_err(|_| String::from("The passkey request was invalid."))
}

fn find_pending_passkey<'a>(state: &'a Value, pending_id: &str) -> Option<&'a Value> {
    pending_passkeys(Some(state))
        .iter()
        .find(|passkey| string_field(passkey, "id") == Some(pending_id))
}

fn find_site_passkey<'a>(state: &'a Value, credential_id: &str) -> Option<&'a Value> {
    site_passkeys(Some(state))
        .iter()
        .find(|passkey| string_field(passkey, "credentialId") == Some(credential_id))
}

fn remove_pending_passkey(state: &mut Value, pending_id: &str) -> bool {
    let pending = ensure_array(state, "pendingPasskeys");
    let initial_len = pending.len();
    pending.retain(|passkey| string_field(passkey, "id") != Some(pending_id));
    pending.len() != initial_len
}

fn prune_pending_passkeys(state: &mut Value) {
    let cutoff = now_ms().saturating_sub(PENDING_TTL_MS);
    ensure_array(state, "pendingPasskeys").retain(|passkey| {
        string_field(passkey, "createdAt")
            .and_then(|value| value.parse::<u128>().ok())
            .is_some_and(|created_at| created_at >= cutoff)
    });
}

fn touch_passkey(state: &mut Value, credential_id: &str, sign_count: u64) {
    let now = now_ms().to_string();
    if let Some(passkey) = ensure_array(state, "sitePasskeys")
        .iter_mut()
        .find(|passkey| string_field(passkey, "credentialId") == Some(credential_id))
    {
        passkey["signCount"] = json!(sign_count);
        passkey["lastUsedAt"] = json!(now);
    }
}

fn ensure_array<'a>(state: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !state.get(key).is_some_and(Value::is_array) {
        state[key] = json!([]);
    }
    state
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .expect("state array")
}

fn error_result(title: impl Into<String>, message: impl Into<String>) -> Value {
    json!({
        "status": "error",
        "title": title.into(),
        "message": message.into()
    })
}

fn is_account_match(left: Option<&str>, right: &str) -> bool {
    left.is_some_and(|left| left.trim().eq_ignore_ascii_case(right.trim()))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
