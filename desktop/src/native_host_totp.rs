use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn current_otp_code(item: &Value) -> Option<String> {
    let otp = item.get("otp")?;
    let details = otp_details(otp)?;
    totp_code(&details)
}

struct OtpDetails {
    secret: String,
    digits: u32,
    period: u64,
    algorithm: String,
}

fn otp_details(value: &Value) -> Option<OtpDetails> {
    if let Some(text) = value.as_str() {
        return parse_otp_text(text);
    }

    let object = value.as_object()?;
    let secret = object.get("secret").and_then(Value::as_str)?.to_string();
    let digits = bounded_digits(object.get("digits").and_then(Value::as_u64).unwrap_or(6));
    let period = bounded_period(object.get("period").and_then(Value::as_u64).unwrap_or(30));
    let algorithm = object
        .get("algorithm")
        .and_then(Value::as_str)
        .unwrap_or("SHA1")
        .to_ascii_uppercase();

    Some(OtpDetails {
        secret,
        digits,
        period,
        algorithm,
    })
}

fn parse_otp_text(value: &str) -> Option<OtpDetails> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.to_ascii_lowercase().starts_with("otpauth://") {
        let parsed = url::Url::parse(trimmed).ok()?;
        let mut secret = None;
        let mut digits = 6;
        let mut period = 30;
        let mut algorithm = String::from("SHA1");

        for (key, value) in parsed.query_pairs() {
            match key.as_ref() {
                "secret" => secret = Some(value.to_string()),
                "digits" => digits = bounded_digits(value.parse::<u64>().unwrap_or(6)),
                "period" => period = bounded_period(value.parse::<u64>().unwrap_or(30)),
                "algorithm" => algorithm = value.to_ascii_uppercase(),
                _ => {}
            }
        }

        return Some(OtpDetails {
            secret: secret?,
            digits,
            period,
            algorithm,
        });
    }

    Some(OtpDetails {
        secret: trimmed.to_string(),
        digits: 6,
        period: 30,
        algorithm: String::from("SHA1"),
    })
}

fn bounded_digits(value: u64) -> u32 {
    if (6..=8).contains(&value) {
        value as u32
    } else {
        6
    }
}

fn bounded_period(value: u64) -> u64 {
    if (5..=300).contains(&value) {
        value
    } else {
        30
    }
}

fn totp_code(details: &OtpDetails) -> Option<String> {
    let secret = decode_base32_secret(&details.secret)?;
    let counter =
        SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() / details.period.max(1);
    let counter_bytes = counter.to_be_bytes();
    let digest = match details.algorithm.as_str() {
        "SHA256" => hmac_digest(&secret, &counter_bytes, 64, sha256_digest),
        "SHA512" => hmac_digest(&secret, &counter_bytes, 128, sha512_digest),
        _ => hmac_digest(&secret, &counter_bytes, 64, sha1_digest),
    };
    if digest.len() < 20 {
        return None;
    }

    let offset = usize::from(digest[digest.len() - 1] & 0x0f);
    if offset + 4 > digest.len() {
        return None;
    }

    let binary = ((u32::from(digest[offset]) & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    let modulus = 10_u32.checked_pow(details.digits)?;
    Some(format!(
        "{:0width$}",
        binary % modulus,
        width = details.digits as usize
    ))
}

fn decode_base32_secret(value: &str) -> Option<Vec<u8>> {
    let mut buffer: u32 = 0;
    let mut bits = 0;
    let mut output = Vec::new();

    for byte in value.bytes() {
        let value = match byte {
            b'A'..=b'Z' => u32::from(byte - b'A'),
            b'a'..=b'z' => u32::from(byte - b'a'),
            b'2'..=b'7' => u32::from(byte - b'2' + 26),
            b'=' | b' ' | b'\t' | b'\r' | b'\n' | b'-' => continue,
            _ => return None,
        };

        buffer = (buffer << 5) | value;
        bits += 5;

        while bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn hmac_digest(
    key: &[u8],
    message: &[u8],
    block_size: usize,
    digest: fn(&[u8]) -> Vec<u8>,
) -> Vec<u8> {
    let mut key_block = if key.len() > block_size {
        digest(key)
    } else {
        key.to_vec()
    };
    key_block.resize(block_size, 0);

    let mut inner = Vec::with_capacity(block_size + message.len());
    let mut outer = Vec::with_capacity(block_size + 64);
    for byte in key_block {
        inner.push(byte ^ 0x36);
        outer.push(byte ^ 0x5c);
    }
    inner.extend_from_slice(message);
    outer.extend_from_slice(&digest(&inner));
    digest(&outer)
}

fn sha1_digest(value: &[u8]) -> Vec<u8> {
    use sha1::Digest;

    let mut hasher = sha1::Sha1::new();
    hasher.update(value);
    hasher.finalize().to_vec()
}

fn sha256_digest(value: &[u8]) -> Vec<u8> {
    use sha2::Digest;

    let mut hasher = sha2::Sha256::new();
    hasher.update(value);
    hasher.finalize().to_vec()
}

fn sha512_digest(value: &[u8]) -> Vec<u8> {
    use sha2::Digest;

    let mut hasher = sha2::Sha512::new();
    hasher.update(value);
    hasher.finalize().to_vec()
}
