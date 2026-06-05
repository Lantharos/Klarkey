use crate::native_host_items::string_field;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ciborium::value::{Integer, Value as CborValue};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use url::Url;

const CHALLENGE_MIN_BYTES: usize = 16;
const CHALLENGE_MAX_BYTES: usize = 1024;
const USER_HANDLE_MAX_BYTES: usize = 64;

pub(crate) struct CreatedCredential {
    pub(crate) credential_id: String,
    pub(crate) rp_id: String,
    pub(crate) user_handle: String,
    pub(crate) private_key_jwk: Value,
    pub(crate) response_json: String,
}

pub(crate) struct Assertion {
    pub(crate) response_json: String,
    pub(crate) sign_count: u64,
}

pub(crate) fn create_credential(
    origin: &str,
    request_json: &str,
    existing_ids: Vec<String>,
) -> Result<CreatedCredential, String> {
    let request = parse_json(request_json)?;
    validate_es256_support(&request)?;
    let exclude_ids = request
        .get("excludeCredentials")
        .and_then(Value::as_array)
        .map(|credentials| {
            credentials
                .iter()
                .filter_map(|credential| credential.get("id").and_then(Value::as_str))
                .filter_map(|id| normalize_credential_id(id).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if existing_ids
        .iter()
        .any(|id| exclude_ids.iter().any(|excluded| excluded == id))
    {
        return Err(String::from(
            "This site asked Klarkey not to reuse an existing passkey for this account.",
        ));
    }

    let challenge = decode_required(
        request.get("challenge").and_then(Value::as_str),
        "The site did not provide a valid passkey challenge.",
        CHALLENGE_MIN_BYTES,
        CHALLENGE_MAX_BYTES,
    )?;
    let user_handle = decode_required(
        request.pointer("/user/id").and_then(Value::as_str),
        "The site did not provide a valid passkey user id.",
        1,
        USER_HANDLE_MAX_BYTES,
    )?;
    let rp_id = resolve_rp_id(origin, request.pointer("/rp/id").and_then(Value::as_str))?;
    let mut credential_id = [0_u8; 32];
    OsRng.fill_bytes(&mut credential_id);
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let encoded_point = verifying_key.to_encoded_point(false);
    let x = encoded_point
        .x()
        .ok_or_else(|| String::from("The generated passkey is invalid."))?;
    let y = encoded_point
        .y()
        .ok_or_else(|| String::from("The generated passkey is invalid."))?;
    let d = signing_key.to_bytes();
    let public_key_cose = build_cose_public_key(x, y)?;
    let public_key_spki = build_spki(encoded_point.as_bytes());
    let authenticator_data = build_authenticator_data(
        &rp_id,
        0x01 | 0x04 | 0x08 | 0x10 | 0x40,
        0,
        Some(&credential_id),
        Some(&public_key_cose),
    );
    let client_data_json = build_client_data_json("webauthn.create", &challenge, origin);
    let attestation_object = build_attestation_object(&authenticator_data)?;
    let response_json = json!({
        "id": encode_base64(credential_id),
        "rawId": encode_base64(credential_id),
        "type": "public-key",
        "authenticatorAttachment": "platform",
        "clientExtensionResults": client_extension_results(&request),
        "response": {
            "clientDataJSON": encode_base64(&client_data_json),
            "attestationObject": encode_base64(&attestation_object),
            "authenticatorData": encode_base64(&authenticator_data),
            "publicKey": encode_base64(&public_key_spki),
            "publicKeyAlgorithm": -7,
            "transports": ["internal"]
        }
    });

    Ok(CreatedCredential {
        credential_id: encode_base64(credential_id),
        rp_id,
        user_handle: encode_base64(&user_handle),
        private_key_jwk: json!({
            "kty": "EC",
            "crv": "P-256",
            "x": encode_base64(x),
            "y": encode_base64(y),
            "d": encode_base64(d.as_slice())
        }),
        response_json: response_json.to_string(),
    })
}

pub(crate) fn get_assertion(
    origin: &str,
    request_json: &str,
    passkey: &Value,
) -> Result<Assertion, String> {
    let request = parse_json(request_json)?;
    let challenge = decode_required(
        request.get("challenge").and_then(Value::as_str),
        "The site did not provide a valid passkey challenge.",
        CHALLENGE_MIN_BYTES,
        CHALLENGE_MAX_BYTES,
    )?;
    let rp_id = resolve_rp_id(origin, request.get("rpId").and_then(Value::as_str))?;
    if string_field(passkey, "rpId") != Some(rp_id.as_str()) {
        return Err(String::from(
            "The saved passkey does not belong to this relying party.",
        ));
    }

    let signing_key = signing_key_from_passkey(passkey)?;
    let sign_count = passkey
        .get("signCount")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .saturating_add(1);
    let client_data_json = build_client_data_json("webauthn.get", &challenge, origin);
    let authenticator_data = build_authenticator_data(
        &rp_id,
        0x01 | 0x04 | 0x08 | 0x10,
        sign_count as u32,
        None,
        None,
    );
    let mut signature_base = authenticator_data.clone();
    signature_base.extend_from_slice(&sha256(&client_data_json));
    let signature: Signature = signing_key.sign(&signature_base);
    let user_handle = string_field(passkey, "userHandle")
        .and_then(|value| decode_base64(value).ok())
        .map(encode_base64);
    let credential_id = string_field(passkey, "credentialId").unwrap_or_default();
    let response_json = json!({
        "id": credential_id,
        "rawId": credential_id,
        "type": "public-key",
        "authenticatorAttachment": "platform",
        "clientExtensionResults": {},
        "response": {
            "clientDataJSON": encode_base64(&client_data_json),
            "authenticatorData": encode_base64(&authenticator_data),
            "signature": encode_base64(signature.to_der().as_bytes()),
            "userHandle": user_handle
        }
    });

    Ok(Assertion {
        response_json: response_json.to_string(),
        sign_count,
    })
}

pub(crate) fn resolve_rp_id(origin: &str, requested: Option<&str>) -> Result<String, String> {
    let parsed = Url::parse(origin).map_err(|_| String::from("The passkey origin is invalid."))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| String::from("The passkey origin is invalid."))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let rp_id = requested
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&host)
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();

    if rp_id.is_empty()
        || rp_id.contains("..")
        || rp_id.starts_with('.')
        || !rp_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
    {
        return Err(String::from(
            "The site requested an invalid passkey relying party id.",
        ));
    }

    if rp_id != "localhost" && rp_id.parse::<IpAddr>().is_err() && !rp_id.contains('.') {
        return Err(String::from(
            "The site requested an invalid passkey relying party id.",
        ));
    }

    if rp_id != host && !host.ends_with(&format!(".{rp_id}")) {
        return Err(String::from(
            "The passkey relying party id does not match this site.",
        ));
    }

    Ok(rp_id)
}

pub(crate) fn normalize_credential_id(value: &str) -> Result<String, String> {
    decode_base64(value).map(encode_base64)
}

fn parse_json(value: &str) -> Result<Value, String> {
    serde_json::from_str(value).map_err(|_| String::from("The passkey request was invalid."))
}

fn validate_es256_support(request: &Value) -> Result<(), String> {
    let supported = request
        .get("pubKeyCredParams")
        .and_then(Value::as_array)
        .is_some_and(|params| {
            params.iter().any(|entry| {
                entry.get("type").and_then(Value::as_str) == Some("public-key")
                    && entry.get("alg").and_then(Value::as_i64) == Some(-7)
            })
        });
    if supported {
        Ok(())
    } else {
        Err(String::from(
            "This site does not allow ES256 passkeys, so Klarkey cannot create one here yet.",
        ))
    }
}

fn decode_required(
    value: Option<&str>,
    message: &str,
    min: usize,
    max: usize,
) -> Result<Vec<u8>, String> {
    let decoded = value
        .and_then(|value| decode_base64(value).ok())
        .ok_or_else(|| message.to_string())?;
    if decoded.len() < min || decoded.len() > max {
        Err(message.to_string())
    } else {
        Ok(decoded)
    }
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(value.as_bytes())
        .map_err(|_| String::from("The passkey request was invalid."))
}

fn encode_base64(bytes: impl AsRef<[u8]>) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sha256(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

fn build_client_data_json(kind: &str, challenge: &[u8], origin: &str) -> Vec<u8> {
    json!({
        "type": kind,
        "challenge": encode_base64(challenge),
        "origin": origin,
        "crossOrigin": false
    })
    .to_string()
    .into_bytes()
}

fn build_authenticator_data(
    rp_id: &str,
    flags: u8,
    sign_count: u32,
    credential_id: Option<&[u8]>,
    public_key: Option<&[u8]>,
) -> Vec<u8> {
    let mut output = sha256(rp_id.as_bytes());
    output.push(flags);
    output.extend_from_slice(&sign_count.to_be_bytes());
    if let (Some(credential_id), Some(public_key)) = (credential_id, public_key) {
        output.extend_from_slice(&[0; 16]);
        output.extend_from_slice(&(credential_id.len() as u16).to_be_bytes());
        output.extend_from_slice(credential_id);
        output.extend_from_slice(public_key);
    }
    output
}

fn build_cose_public_key(x: &[u8], y: &[u8]) -> Result<Vec<u8>, String> {
    to_cbor(CborValue::Map(vec![
        (
            CborValue::Integer(Integer::from(1)),
            CborValue::Integer(Integer::from(2)),
        ),
        (
            CborValue::Integer(Integer::from(3)),
            CborValue::Integer(Integer::from(-7)),
        ),
        (
            CborValue::Integer(Integer::from(-1)),
            CborValue::Integer(Integer::from(1)),
        ),
        (
            CborValue::Integer(Integer::from(-2)),
            CborValue::Bytes(x.to_vec()),
        ),
        (
            CborValue::Integer(Integer::from(-3)),
            CborValue::Bytes(y.to_vec()),
        ),
    ]))
}

fn build_attestation_object(authenticator_data: &[u8]) -> Result<Vec<u8>, String> {
    to_cbor(CborValue::Map(vec![
        (
            CborValue::Text(String::from("fmt")),
            CborValue::Text(String::from("none")),
        ),
        (
            CborValue::Text(String::from("attStmt")),
            CborValue::Map(Vec::new()),
        ),
        (
            CborValue::Text(String::from("authData")),
            CborValue::Bytes(authenticator_data.to_vec()),
        ),
    ]))
}

fn to_cbor(value: CborValue) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    ciborium::ser::into_writer(&value, &mut output)
        .map_err(|_| String::from("The passkey response could not be encoded."))?;
    Ok(output)
}

fn build_spki(uncompressed_point: &[u8]) -> Vec<u8> {
    der_sequence(
        &[
            der_sequence(
                &[
                    der_oid(&[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]),
                    der_oid(&[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]),
                ]
                .concat(),
            ),
            der_bit_string(uncompressed_point),
        ]
        .concat(),
    )
}

fn der_sequence(content: &[u8]) -> Vec<u8> {
    der_tagged(0x30, content)
}

fn der_oid(content: &[u8]) -> Vec<u8> {
    der_tagged(0x06, content)
}

fn der_bit_string(content: &[u8]) -> Vec<u8> {
    let mut bit_string = Vec::with_capacity(content.len() + 1);
    bit_string.push(0);
    bit_string.extend_from_slice(content);
    der_tagged(0x03, &bit_string)
}

fn der_tagged(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut output = vec![tag];
    write_der_len(&mut output, content.len());
    output.extend_from_slice(content);
    output
}

fn write_der_len(output: &mut Vec<u8>, len: usize) {
    if len < 128 {
        output.push(len as u8);
        return;
    }
    let bytes = len.to_be_bytes();
    let first = bytes
        .iter()
        .position(|byte| *byte != 0)
        .unwrap_or(bytes.len() - 1);
    output.push(0x80 | (bytes.len() - first) as u8);
    output.extend_from_slice(&bytes[first..]);
}

fn client_extension_results(request: &Value) -> Value {
    if request.pointer("/extensions/credProps").is_none() {
        return json!({});
    }
    let resident_key = request
        .pointer("/authenticatorSelection/residentKey")
        .and_then(Value::as_str);
    let rk = matches!(resident_key, Some("required" | "preferred"))
        || request
            .pointer("/authenticatorSelection/requireResidentKey")
            .and_then(Value::as_bool)
            == Some(true);
    json!({ "credProps": { "rk": rk } })
}

fn signing_key_from_passkey(passkey: &Value) -> Result<SigningKey, String> {
    let d = decode_required(
        passkey.pointer("/privateKeyJwk/d").and_then(Value::as_str),
        "The saved passkey private key is invalid.",
        32,
        32,
    )?;
    SigningKey::from_slice(&d)
        .map_err(|_| String::from("The saved passkey private key is invalid."))
}
