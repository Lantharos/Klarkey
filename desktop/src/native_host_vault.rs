use crate::native_host_items::{
    field_suggestions, fill_login, fill_record, list_site_matches, save_login,
};
pub(crate) use crate::native_host_vault_response::{error_response, response_id};
use crate::native_host_vault_response::{
    locked_response, ok_response, string_value, system_auth_ready,
};
use crate::native_host_vault_state::{
    checked_state, editable_state, is_locked, listing_state, metadata_locked, readable_state,
    settings_from, vault_metadata, write_state,
};
use crate::native_host_webauthn::{
    create_passkey_credential, discard_passkey_credential, get_passkey_credential, passkeys_status,
    plan_passkey_create, plan_passkey_get, plan_passkey_get_from_index, save_passkey_credential,
};
use serde_json::{json, Value};

pub(crate) fn response_for(request: Value) -> Value {
    let id = response_id(&request);
    let request_type = request.get("type").and_then(Value::as_str);

    match request_type {
        Some("ping") => {
            let state = readable_state();
            ok_response(
                id,
                json!({
                    "protocolVersion": 1,
                    "desktopRequired": true,
                    "passkeyProviderReady": false,
                    "nativeUserVerificationReady": system_auth_ready(),
                    "vaultUnlocked": !is_locked(state.as_ref()),
                    "availability": "online"
                }),
            )
        }
        Some("get-settings") => {
            let state = readable_state();
            ok_response(id, json!({ "settings": settings_from(state.as_ref()) }))
        }
        Some("request-unlock") => {
            if metadata_locked() {
                return locked_response(id);
            }
            ok_response(
                id,
                json!({
                    "status": "success",
                    "title": "Vault ready",
                    "message": "Klarkey is unlocked."
                }),
            )
        }
        Some("list-logins") => {
            let (state, locked) = listing_state();
            let url = string_value(&request, "url").unwrap_or_default();
            let mut result = json!({ "matches": list_site_matches(state.as_ref(), &url) });
            if locked {
                result["locked"] = json!(true);
            }
            ok_response(id, result)
        }
        Some("get-login") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            ok_response(
                id,
                json!({ "login": fill_login(state.as_ref(), &item_id, &url) }),
            )
        }
        Some("get-identity") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            ok_response(
                id,
                json!({ "identity": fill_record(state.as_ref(), &item_id, "identity") }),
            )
        }
        Some("get-card") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            ok_response(
                id,
                json!({ "card": fill_record(state.as_ref(), &item_id, "card") }),
            )
        }
        Some("list-field-suggestions") => {
            let (state, locked) = listing_state();
            let field = string_value(&request, "field").unwrap_or_default();
            let flow = string_value(&request, "flow").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let mut result = json!({ "suggestions": field_suggestions(state.as_ref(), &field, &flow, &url, locked) });
            if locked {
                result["locked"] = json!(true);
            }
            ok_response(id, result)
        }
        Some("save-login") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let result = save_login(&mut state, request.get("payload"));
            if result.get("status").and_then(Value::as_str) == Some("success") {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkeys-status") => {
            let state = readable_state();
            let url = string_value(&request, "url").unwrap_or_default();
            ok_response(
                id,
                passkeys_status(state.as_ref(), &url, is_locked(state.as_ref())),
            )
        }
        Some("passkey-create-plan") => {
            let state = readable_state();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            ok_response(id, plan_passkey_create(state.as_ref(), &url, &request_json))
        }
        Some("passkey-create-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let origin = string_value(&request, "origin").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let result = create_passkey_credential(&mut state, &origin, &url, &request_json);
            if result.get("responseJson").is_some() {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkey-save-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let pending_id = string_value(&request, "pendingPasskeyId").unwrap_or_default();
            let item_id = request.get("itemId").and_then(Value::as_str);
            let create_new = request
                .get("createNew")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let result = save_passkey_credential(
                &mut state,
                &pending_id,
                &url,
                &request_json,
                item_id,
                create_new,
            );
            if result.get("status").and_then(Value::as_str) == Some("success") {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkey-discard-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            let pending_id = string_value(&request, "pendingPasskeyId").unwrap_or_default();
            let result = discard_passkey_credential(&mut state, &pending_id);
            let _ = write_state(&state);
            ok_response(id, result)
        }
        Some("passkey-get-plan") => {
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let unlock = request
                .get("unlock")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !unlock {
                if let Some(metadata) = vault_metadata() {
                    if metadata.locked {
                        return ok_response(
                            id,
                            plan_passkey_get_from_index(
                                &metadata.passkey_index,
                                &url,
                                &request_json,
                            ),
                        );
                    }
                }
            }
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            ok_response(
                id,
                plan_passkey_get(
                    state.as_ref(),
                    &url,
                    &request_json,
                    is_locked(state.as_ref()),
                ),
            )
        }
        Some("passkey-get-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let origin = string_value(&request, "origin").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let credential_id = string_value(&request, "credentialId").unwrap_or_default();
            let result =
                get_passkey_credential(&mut state, &origin, &url, &request_json, &credential_id);
            if result.get("responseJson").is_some() {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("__invalid_json") => error_response(
            id,
            "invalid_json",
            "The browser request was not valid JSON.",
        ),
        Some(_) | None => error_response(
            id,
            "unsupported_request",
            "The requested browser extension action is not supported.",
        ),
    }
}
