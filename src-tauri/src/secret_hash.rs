use base64::{engine::general_purpose::STANDARD, Engine as _};
use pbkdf2::{pbkdf2_hmac, sha2::Digest, sha2::Sha256};
use serde::Deserialize;
use serde_json::Value;

const MINIMUM_ITERATIONS: u32 = 100_000;
const MAXIMUM_ITERATIONS: u32 = 1_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pbkdf2SecretHash {
    version: u8,
    algorithm: String,
    salt: String,
    iterations: u32,
    hash: String,
}

pub(crate) fn verify_secret(secret: &str, stored: Option<&Value>) -> bool {
    match stored {
        Some(Value::String(hash)) => verify_legacy_sha256(secret, hash),
        Some(value) => serde_json::from_value::<Pbkdf2SecretHash>(value.clone())
            .ok()
            .is_some_and(|hash| verify_pbkdf2(secret, &hash)),
        None => false,
    }
}

fn verify_legacy_sha256(secret: &str, stored: &str) -> bool {
    let digest = Sha256::digest(secret.as_bytes());
    let computed = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    constant_time_equal(computed.as_bytes(), stored.as_bytes())
}

fn verify_pbkdf2(secret: &str, stored: &Pbkdf2SecretHash) -> bool {
    if stored.version != 2
        || stored.algorithm != "PBKDF2-SHA-256"
        || stored.iterations < MINIMUM_ITERATIONS
        || stored.iterations > MAXIMUM_ITERATIONS
    {
        return false;
    }

    let Ok(salt) = STANDARD.decode(&stored.salt) else {
        return false;
    };
    let Ok(expected) = STANDARD.decode(&stored.hash) else {
        return false;
    };
    if expected.len() != 32 {
        return false;
    }

    let mut computed = [0u8; 32];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), &salt, stored.iterations, &mut computed);
    constant_time_equal(&computed, &expected)
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}
