use crate::native_host_item_fields::{
    find_item, item_site_score, new_id, normalize_host, site_origin, string_field,
};
use crate::native_host_items::list_site_matches;
use crate::native_host_webauthn_crypto::{create_credential, get_assertion, resolve_rp_id};
use serde_json::{json, Map, Value};

use crate::native_host_passkeys::{
    ensure_array, error_result, find_pending_passkey, is_account_match, known_credential_ids,
    now_ms, parse_json, passkey_choices, prune_pending_passkeys, remove_pending_passkey,
    save_site_passkey, site_passkeys, touch_passkey, usable_passkey_records, usable_passkeys,
};
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
        "conditionalUi": true,
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
    let choices = passkey_choices(usable_passkeys(state, url, request_json));
    let mut result = json!({ "choices": choices });
    if locked {
        result["locked"] = json!(true);
    }
    result
}

pub(crate) fn plan_passkey_get_from_index(
    passkey_index: &[Value],
    url: &str,
    request_json: &str,
) -> Value {
    let choices = passkey_choices(usable_passkey_records(
        passkey_index,
        None,
        url,
        request_json,
        false,
    ));
    json!({
        "needsUnlockForChoices": choices.is_empty(),
        "choices": choices,
        "locked": true
    })
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
