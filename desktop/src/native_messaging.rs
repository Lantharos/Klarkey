use crate::native_host_vault::{error_response, response_for, response_id};
use serde_json::{json, Value};
use std::io::{self, Read, Write};

const MAX_MESSAGE_LENGTH: u32 = 10 * 1024 * 1024;
const MAX_RESPONSE_LENGTH: usize = 1024 * 1024;

pub fn run() {
    while let Ok(Some(request)) = read_message() {
        let response = response_for(request);
        if write_message(&response).is_err() {
            break;
        }
    }
}

fn read_message() -> io::Result<Option<Value>> {
    let mut header = [0_u8; 4];
    match io::stdin().read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }

    let message_length = u32::from_le_bytes(header);
    if message_length == 0 || message_length > MAX_MESSAGE_LENGTH {
        return Ok(None);
    }

    let mut buffer = vec![0_u8; message_length as usize];
    io::stdin().read_exact(&mut buffer)?;
    Ok(Some(serde_json::from_slice(&buffer).unwrap_or_else(|_| {
        json!({
            "id": "unknown",
            "type": "__invalid_json"
        })
    })))
}

fn write_message(response: &Value) -> io::Result<()> {
    let mut message = serde_json::to_vec(response)?;
    if message.len() > MAX_RESPONSE_LENGTH {
        let id = response_id(response);
        message = serde_json::to_vec(&error_response(
            id,
            "native_host_response_too_large",
            "The browser response was too large to return safely.",
        ))?;
    }

    io::stdout().write_all(&(message.len() as u32).to_le_bytes())?;
    io::stdout().write_all(&message)?;
    io::stdout().flush()
}
