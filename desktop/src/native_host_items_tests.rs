use super::{field_suggestions, fill_login, list_site_matches};
use serde_json::{json, Value};

fn suggestion_sources(value: Value) -> Vec<String> {
    value
        .as_array()
        .expect("suggestions array")
        .iter()
        .map(|suggestion| {
            suggestion
                .get("source")
                .and_then(Value::as_str)
                .expect("source")
                .to_string()
        })
        .collect()
}

#[test]
fn login_username_suggestions_only_include_site_logins() {
    let state = json!({
        "items": [
            {
                "itemId": "identity",
                "itemType": "identity",
                "itemName": "Personal",
                "username": "identity-user"
            },
            {
                "itemId": "login",
                "itemType": "login",
                "itemName": "Exaroton",
                "username": "saved-user",
                "websites": ["https://exaroton.com"]
            }
        ]
    });

    let suggestions = field_suggestions(
        Some(&state),
        "username",
        "login",
        "https://exaroton.com/login",
        false,
    );

    assert_eq!(suggestion_sources(suggestions), vec!["login-username"]);
}

#[test]
fn register_username_suggestions_only_include_identities() {
    let state = json!({
        "items": [
            {
                "itemId": "identity",
                "itemType": "identity",
                "itemName": "Personal",
                "username": "identity-user"
            },
            {
                "itemId": "login",
                "itemType": "login",
                "itemName": "Exaroton",
                "username": "saved-user",
                "websites": ["https://exaroton.com"]
            }
        ]
    });

    let suggestions = field_suggestions(
        Some(&state),
        "username",
        "register",
        "https://exaroton.com/register",
        false,
    );

    assert_eq!(suggestion_sources(suggestions), vec!["identity"]);
}

#[test]
fn login_email_suggestions_use_login_username_values() {
    let state = json!({
        "items": [
            {
                "itemId": "identity",
                "itemType": "identity",
                "itemName": "Personal",
                "email": "identity@example.com"
            },
            {
                "itemId": "login",
                "itemType": "login",
                "itemName": "Example",
                "username": "saved@example.com",
                "websites": ["https://example.com"]
            }
        ]
    });

    let suggestions = field_suggestions(
        Some(&state),
        "email",
        "login",
        "https://example.com/login",
        false,
    );
    let suggestion = suggestions
        .as_array()
        .expect("suggestions array")
        .first()
        .expect("first suggestion");

    assert_eq!(
        suggestion_sources(suggestions.clone()),
        vec!["login-username"]
    );
    assert_eq!(
        suggestion.get("value").and_then(Value::as_str),
        Some("saved@example.com")
    );
}

#[test]
fn card_number_suggestions_only_expose_card_display_metadata() {
    let state = json!({
        "items": [
            {
                "itemId": "card",
                "itemType": "card",
                "itemName": "Subscriptions Jr",
                "cardholderName": "Kristof Imeri",
                "cardNumber": "5424023100408367",
                "cardBrand": "mc"
            }
        ]
    });

    let suggestions = field_suggestions(
        Some(&state),
        "cardNumber",
        "payment",
        "https://checkout.example.com",
        false,
    );
    let suggestion = suggestions
        .as_array()
        .expect("suggestions array")
        .first()
        .expect("first suggestion");

    assert_eq!(
        suggestion.get("source").and_then(Value::as_str),
        Some("card")
    );
    assert_eq!(
        suggestion.get("displayValue").and_then(Value::as_str),
        Some("Subscriptions Jr")
    );
    assert_eq!(
        suggestion.get("displaySecondary").and_then(Value::as_str),
        Some("Mastercard ending in 8367")
    );
    assert_eq!(
        suggestion.get("cardBrand").and_then(Value::as_str),
        Some("Mastercard")
    );
    assert_eq!(
        suggestion.get("cardLastFour").and_then(Value::as_str),
        Some("8367")
    );
    assert_ne!(
        suggestion.get("value").and_then(Value::as_str),
        Some("5424023100408367")
    );
    assert!(!serde_json::to_string(suggestion)
        .expect("serialized suggestion")
        .contains("5424023100408367"));
}

#[test]
fn fill_login_includes_current_otp_code() {
    let state = json!({
        "items": [
            {
                "itemId": "login",
                "itemType": "login",
                "itemName": "Example",
                "username": "saved@example.com",
                "password": "secret",
                "websites": ["https://example.com"],
                "otp": {
                    "secret": "JBSWY3DPEHPK3PXP",
                    "digits": 6,
                    "period": 30,
                    "algorithm": "SHA1"
                }
            }
        ]
    });

    let login = fill_login(Some(&state), "login", "https://example.com/login");

    assert_eq!(
        login
            .get("otp")
            .and_then(Value::as_str)
            .map(|value| value.len()),
        Some(6)
    );
}

#[test]
fn site_matches_support_locked_metadata_index_entries() {
    let state = json!({
        "items": [
            {
                "itemId": "login",
                "itemType": "login",
                "itemName": "Example",
                "username": "saved@example.com",
                "websites": ["https://example.com"],
                "hasPassword": true,
                "hasOtp": true,
                "hasPasskey": true
            }
        ]
    });

    let matches = list_site_matches(Some(&state), "https://example.com/login");
    let first = matches
        .as_array()
        .expect("matches array")
        .first()
        .expect("first match");

    assert_eq!(first.get("itemId").and_then(Value::as_str), Some("login"));
    assert_eq!(
        first.get("hasPassword").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(first.get("hasOtp").and_then(Value::as_bool), Some(true));
    assert_eq!(first.get("hasPasskey").and_then(Value::as_bool), Some(true));
}
