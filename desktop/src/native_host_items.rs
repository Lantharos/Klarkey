pub(crate) use crate::native_host_item_fields::{
    array_strings, find_item, item_site_score, items, new_id, normalize_host, now_iso_like,
    site_origin, string_field,
};
use crate::native_host_totp::current_otp_code;
use serde_json::{json, Map, Value};

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
    insert_string(&mut object, "otp", current_otp_code(item).as_deref());
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
    flow: &str,
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

        let (source, value_field) = match item_type {
            "login"
                if flow == "login"
                    && (field == "username" || field == "email")
                    && from_site_match =>
            {
                ("login-username", "username")
            }
            "identity" if flow == "register" || flow == "payment" => ("identity", field),
            "card" if flow == "payment" && !locked => ("card", field),
            _ => continue,
        };

        if source == "card" {
            if let Some(suggestion) =
                card_field_suggestion(item, item_id, item_name, field, from_site_match)
            {
                suggestions.push(suggestion);
            }
            continue;
        }

        let Some(value) = string_field(item, value_field) else {
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

fn card_field_suggestion(
    item: &Value,
    item_id: &str,
    item_name: &str,
    field: &str,
    from_site_match: bool,
) -> Option<Value> {
    string_field(item, field)?;

    let title = card_display_title(item, item_name);
    let last_four = card_last_four(item);
    let brand = string_field(item, "cardBrand").and_then(card_display_brand);
    let secondary = card_display_secondary(brand.as_deref(), last_four.as_deref());
    let mut object = Map::new();
    object.insert(
        "id".into(),
        Value::String(format!("suggestion:{item_id}:{field}")),
    );
    object.insert("itemId".into(), Value::String(item_id.to_string()));
    object.insert("itemName".into(), Value::String(item_name.to_string()));
    object.insert("value".into(), Value::String(title.clone()));
    object.insert("displayValue".into(), Value::String(title));
    object.insert("field".into(), Value::String(field.to_string()));
    object.insert("source".into(), Value::String(String::from("card")));
    object.insert("fromSiteMatch".into(), Value::Bool(from_site_match));
    if let Some(value) = string_field(item, "lastUsedAt") {
        object.insert("lastUsedAt".into(), Value::String(value.to_string()));
    }
    if let Some(value) = last_four {
        object.insert("cardLastFour".into(), Value::String(value));
    }
    if let Some(value) = brand {
        object.insert("cardBrand".into(), Value::String(value));
    }
    if let Some(value) = secondary {
        object.insert("displaySecondary".into(), Value::String(value));
    }
    Some(Value::Object(object))
}

fn card_display_title(item: &Value, item_name: &str) -> String {
    if !item_name.trim().is_empty() && item_name != "Untitled" && !looks_like_card_number(item_name)
    {
        return item_name.to_string();
    }
    if let Some(cardholder) = string_field(item, "cardholderName") {
        return cardholder.to_string();
    }
    string_field(item, "cardBrand")
        .and_then(card_display_brand)
        .unwrap_or_else(|| String::from("Payment card"))
}

fn card_display_secondary(brand: Option<&str>, last_four: Option<&str>) -> Option<String> {
    match (brand, last_four) {
        (Some(brand), Some(last_four)) => Some(format!("{brand} ending in {last_four}")),
        (None, Some(last_four)) => Some(format!("Ending in {last_four}")),
        (Some(brand), None) => Some(brand.to_string()),
        (None, None) => None,
    }
}

fn card_last_four(item: &Value) -> Option<String> {
    if let Some(last_four) = string_field(item, "cardLastFour") {
        let digits = card_digits(last_four);
        if digits.len() >= 4 {
            return Some(digits[digits.len() - 4..].to_string());
        }
    }
    let digits = card_digits(string_field(item, "cardNumber")?);
    if digits.len() < 4 {
        return None;
    }
    Some(digits[digits.len() - 4..].to_string())
}

fn card_display_brand(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_ascii_lowercase();
    let mapped = match normalized.as_str() {
        "visa" => Some("Visa"),
        "mc" | "mastercard" | "master card" => Some("Mastercard"),
        "amex" | "americanexpress" | "american express" => Some("American Express"),
        "discover" => Some("Discover"),
        "jcb" => Some("JCB"),
        "diners" | "dinersclub" | "diners club" => Some("Diners Club"),
        _ => None,
    };
    mapped
        .map(ToString::to_string)
        .or_else(|| Some(title_case_card_brand(trimmed)))
}

fn title_case_card_brand(value: &str) -> String {
    value
        .split(|character: char| {
            character.is_ascii_whitespace() || character == '-' || character == '_'
        })
        .filter(|part| !part.is_empty())
        .map(|part| {
            if part.len() <= 4 && part.chars().all(|character| character.is_ascii_uppercase()) {
                return part.to_string();
            }

            let mut chars = part.chars();
            let Some(first) = chars.next() else {
                return String::new();
            };
            format!(
                "{}{}",
                first.to_uppercase(),
                chars.as_str().to_ascii_lowercase()
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_card_number(value: &str) -> bool {
    let digits = card_digits(value);
    (12..=19).contains(&digits.len())
}

fn card_digits(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
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

fn site_match_value(item: &Value) -> Option<Value> {
    let item_id = string_field(item, "itemId")?;
    let item_name = string_field(item, "itemName").unwrap_or("Untitled");
    Some(json!({
        "itemId": item_id,
        "itemName": item_name,
        "username": string_field(item, "username"),
        "websites": array_strings(item, "websites"),
        "hasPassword": bool_field(item, "hasPassword") || string_field(item, "password").is_some(),
        "hasOtp": bool_field(item, "hasOtp") || item.get("otp").is_some(),
        "hasPasskey": bool_field(item, "hasPasskey") || item.get("passkeys").and_then(Value::as_array).is_some_and(|values| !values.is_empty()),
        "ssoProvider": string_field(item, "ssoProvider"),
        "lastUsedAt": string_field(item, "lastUsedAt")
    }))
}

fn insert_string(object: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
}

fn bool_field(item: &Value, key: &str) -> bool {
    item.get(key).and_then(Value::as_bool).unwrap_or(false)
}

#[cfg(test)]
#[path = "native_host_items_tests.rs"]
mod tests;
