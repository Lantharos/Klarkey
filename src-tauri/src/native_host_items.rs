use serde_json::{json, Map, Value};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn list_site_matches(state: Option<&Value>, request_url: &str) -> Value {
    let mut matches = items(state)
        .iter()
        .filter_map(|item| {
            let score = item_site_score(item, request_url)?;
            let value = site_match_value(item)?;
            let name = string_field(item, "itemName")
                .unwrap_or_default()
                .to_ascii_lowercase();
            Some((score, name, value))
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    Value::Array(matches.into_iter().map(|(_, _, value)| value).collect())
}

pub(crate) fn fill_login(state: Option<&Value>, item_id: &str, request_url: &str) -> Value {
    let Some(item) = find_item(state, item_id) else {
        return Value::Null;
    };
    if item_site_score(item, request_url).is_none() {
        return Value::Null;
    }

    let mut object = Map::new();
    insert_string(&mut object, "itemId", string_field(item, "itemId"));
    insert_string(&mut object, "itemName", string_field(item, "itemName"));
    insert_string(&mut object, "username", string_field(item, "username"));
    insert_string(&mut object, "password", string_field(item, "password"));
    insert_string(
        &mut object,
        "ssoProvider",
        string_field(item, "ssoProvider"),
    );
    object.insert("websites".into(), json!(array_strings(item, "websites")));
    object.insert(
        "hasPasskey".into(),
        json!(item
            .get("passkeys")
            .and_then(Value::as_array)
            .is_some_and(|values| !values.is_empty())),
    );
    Value::Object(object)
}

pub(crate) fn fill_record(state: Option<&Value>, item_id: &str, expected_type: &str) -> Value {
    let Some(item) = find_item(state, item_id) else {
        return Value::Null;
    };
    if string_field(item, "itemType") != Some(expected_type) {
        return Value::Null;
    }

    let mut object = Map::new();
    insert_string(&mut object, "itemId", string_field(item, "itemId"));
    insert_string(&mut object, "itemName", string_field(item, "itemName"));
    for key in [
        "username",
        "fullName",
        "firstName",
        "middleName",
        "lastName",
        "company",
        "jobTitle",
        "birthDate",
        "email",
        "phone",
        "address",
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "postalCode",
        "country",
        "cardholderName",
        "cardNumber",
        "cardLastFour",
        "cardExpiry",
        "cardExpiryMonth",
        "cardExpiryYear",
        "cardCvc",
        "cardBrand",
        "billingPostalCode",
    ] {
        insert_string(&mut object, key, string_field(item, key));
    }
    Value::Object(object)
}

pub(crate) fn field_suggestions(
    state: Option<&Value>,
    field: &str,
    request_url: &str,
    locked: bool,
) -> Value {
    let mut suggestions = Vec::new();
    for item in items(state) {
        let item_id = match string_field(item, "itemId") {
            Some(value) => value,
            None => continue,
        };
        let item_name = string_field(item, "itemName").unwrap_or("Untitled");
        let item_type = string_field(item, "itemType").unwrap_or("login");
        let from_site_match = item_site_score(item, request_url).is_some();

        let source = match item_type {
            "login" if field == "username" || field == "email" => "login-username",
            "identity" => "identity",
            "card" if !locked => "card",
            _ => continue,
        };
        if item_type == "login" && !from_site_match {
            continue;
        }

        let Some(value) = string_field(item, field) else {
            continue;
        };
        suggestions.push(json!({
            "id": format!("suggestion:{item_id}:{field}"),
            "itemId": item_id,
            "itemName": item_name,
            "value": value,
            "field": field,
            "source": source,
            "lastUsedAt": string_field(item, "lastUsedAt"),
            "fromSiteMatch": from_site_match
        }));
    }
    Value::Array(suggestions)
}

pub(crate) fn save_login(state: &mut Value, payload: Option<&Value>) -> Value {
    let Some(payload) = payload.and_then(Value::as_object) else {
        return json!({
            "status": "error",
            "title": "Could not save login",
            "message": "The browser request was missing login details."
        });
    };

    let Some(url) = payload.get("url").and_then(Value::as_str) else {
        return json!({
            "status": "error",
            "title": "Could not save login",
            "message": "The browser request was missing a site URL."
        });
    };
    let site = site_origin(url).unwrap_or_else(|| url.to_string());
    let host = normalize_host(&site).unwrap_or_else(|| String::from("Saved login"));
    let item_name = payload
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&host)
        .to_string();
    let username = payload
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = payload
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sso_provider = payload.get("ssoProvider").and_then(Value::as_str);

    if !state.get("items").is_some_and(Value::is_array) {
        state["items"] = json!([]);
    }
    let items = state
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .expect("items array");
    let existing_index = items.iter().position(|item| {
        string_field(item, "itemType").unwrap_or("login") == "login"
            && string_field(item, "username").unwrap_or_default() == username
            && item_site_score(item, &site).is_some()
    });

    if let Some(index) = existing_index {
        let item = items[index].as_object_mut().expect("item object");
        item.insert("itemName".into(), json!(item_name));
        item.insert("username".into(), json!(username));
        item.insert("password".into(), json!(password));
        item.insert("updatedAt".into(), json!(now_iso_like()));
        if let Some(sso_provider) = sso_provider {
            item.insert("ssoProvider".into(), json!(sso_provider));
        }
        return json!({
            "status": "success",
            "title": "Login updated",
            "message": format!("{item_name} was updated."),
            "itemId": item.get("itemId").and_then(Value::as_str)
        });
    }

    let item_id = new_id("item");
    items.push(json!({
        "itemId": item_id,
        "itemType": "login",
        "itemName": item_name,
        "updatedAt": now_iso_like(),
        "username": username,
        "password": password,
        "websites": [site],
        "customFields": [],
        "recoveryCodes": [],
        "passkeys": [],
        "ssoProvider": sso_provider
    }));

    json!({
        "status": "success",
        "title": "Login saved",
        "message": "Login saved.",
        "itemId": item_id
    })
}

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
    if saved.contains('.') && requested.ends_with(&format!(".{saved}")) {
        return Some(80);
    }
    None
}

pub(crate) fn item_site_score(item: &Value, request_url: &str) -> Option<i32> {
    array_strings(item, "websites")
        .iter()
        .filter_map(|site| host_match_score(site, request_url))
        .max()
}

fn site_match_value(item: &Value) -> Option<Value> {
    let item_id = string_field(item, "itemId")?;
    let item_name = string_field(item, "itemName").unwrap_or("Untitled");
    Some(json!({
        "itemId": item_id,
        "itemName": item_name,
        "username": string_field(item, "username"),
        "websites": array_strings(item, "websites"),
        "hasPassword": string_field(item, "password").is_some(),
        "hasOtp": item.get("otp").is_some(),
        "hasPasskey": item.get("passkeys").and_then(Value::as_array).is_some_and(|values| !values.is_empty()),
        "ssoProvider": string_field(item, "ssoProvider"),
        "lastUsedAt": string_field(item, "lastUsedAt")
    }))
}

pub(crate) fn find_item<'a>(state: Option<&'a Value>, item_id: &str) -> Option<&'a Value> {
    items(state)
        .iter()
        .find(|item| string_field(item, "itemId") == Some(item_id))
}

fn insert_string(object: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
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
