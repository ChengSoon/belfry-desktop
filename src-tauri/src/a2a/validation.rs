use std::path::Path;

use reqwest::{Url, header::HeaderName};
use serde_json::Value;

use super::{
    contracts::{AuthKind, ConnectionDraft},
    errors::error,
};
use crate::terminal::AppError;

pub(super) const MAX_TEXT_BYTES: usize = 64 * 1024;

pub(super) fn root(path: &str) -> Result<String, AppError> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(error(
            "A2A_PROJECT_INVALID",
            "An absolute project directory is required.",
        ));
    }
    let canonical = crate::resource::canonicalize(path).map_err(|_| {
        error(
            "A2A_PROJECT_INVALID",
            "The project directory is unavailable.",
        )
    })?;
    if !canonical.is_dir() {
        return Err(error(
            "A2A_PROJECT_INVALID",
            "The project path must be a directory.",
        ));
    }
    canonical.to_str().map(str::to_owned).ok_or_else(|| {
        error(
            "A2A_PROJECT_INVALID",
            "The project path cannot be represented as UTF-8.",
        )
    })
}

pub(super) fn url(value: &str) -> Result<Url, AppError> {
    let parsed = if value.len() <= 4096 {
        Url::parse(value).ok()
    } else {
        None
    };
    let parsed = parsed.filter(|url| {
        url.has_host()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && (url.scheme() == "https" || (url.scheme() == "http" && loopback(url)))
    });
    parsed.ok_or_else(|| error("A2A_URL_INVALID", "A2A URLs require HTTPS and must not contain credentials or fragments. HTTP is allowed only for explicit loopback addresses."))
}

pub(super) fn loopback(url: &Url) -> bool {
    let name = url.host_str().unwrap_or("");
    // Never accept lookalike suffixes or resolve an arbitrary name as loopback.
    name == "localhost"
        || name
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

pub(super) fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

pub(super) fn id(value: &str) -> bool {
    value.len() == 26 && value.parse::<ulid::Ulid>().is_ok()
}

pub(super) fn request_id(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
    {
        return Err(error(
            "A2A_REQUEST_ID_INVALID",
            "A unique bounded A2A request ID is required.",
        ));
    }
    Ok(())
}

pub(super) fn header(value: &str) -> Result<String, AppError> {
    let parsed = HeaderName::from_bytes(value.as_bytes()).ok();
    let reserved = [
        "authorization",
        "host",
        "content-type",
        "content-length",
        "transfer-encoding",
        "connection",
        "cookie",
        "set-cookie",
        "a2a-version",
        "a2a-extensions",
        "accept",
        "proxy-authorization",
        "upgrade",
        "te",
        "trailer",
    ];
    parsed
        .filter(|name| value.len() <= 128 && !reserved.contains(&name.as_str()))
        .map(|name| name.as_str().to_owned())
        .ok_or_else(|| {
            error(
                "A2A_AUTH_HEADER_INVALID",
                "Choose a valid API-key header distinct from transport and authorization headers.",
            )
        })
}

pub(super) fn credential(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 8192
        || value.trim() != value
        || !value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(error(
            "A2A_CREDENTIAL_INVALID",
            "The credential must be nonempty printable ASCII without spaces or control characters.",
        ));
    }
    Ok(())
}

pub(super) fn draft(
    value: &ConnectionDraft,
) -> Result<
    (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    ),
    AppError,
> {
    if value.id.as_deref().is_some_and(|value| !id(value))
        || value.name.trim().is_empty()
        || value.name.chars().count() > 120
        || value.name.len() > 512
    {
        return Err(error(
            "A2A_CONNECTION_INVALID",
            "A valid connection ID and a name of at most 120 characters are required.",
        ));
    }
    let card = url(value.card_url.trim())?;
    let interface = value
        .interface_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|value| url(value.trim()))
        .transpose()?;
    let interface_tenant = value
        .interface_tenant
        .as_deref()
        .map(str::trim)
        .filter(|tenant| !tenant.is_empty())
        .map(str::to_owned);
    if interface_tenant
        .as_ref()
        .is_some_and(|tenant| tenant.len() > 512 || interface.is_none())
    {
        return Err(error(
            "A2A_INTERFACE_SELECTION_REQUIRED",
            "A selected interface tenant requires an explicit interface URL of at most 512 bytes.",
        ));
    }
    let header = match value.auth.kind {
        AuthKind::ApiKey => Some(header(value.auth.header_name.as_deref().unwrap_or(""))?),
        _ if value
            .auth
            .header_name
            .as_deref()
            .is_some_and(|s| !s.is_empty()) =>
        {
            return Err(error(
                "A2A_AUTH_HEADER_INVALID",
                "A custom header applies only to API-key authentication.",
            ));
        }
        _ => None,
    };
    let credential_origin = origin(interface.as_ref().unwrap_or(&card));
    Ok((
        card.to_string(),
        interface.map(|url| url.to_string()),
        interface_tenant,
        header,
        credential_origin,
    ))
}

pub(super) fn text(value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > MAX_TEXT_BYTES {
        Err(error(
            "A2A_MESSAGE_INVALID",
            "A2A messages require nonempty text of at most 64 KiB.",
        ))
    } else {
        Ok(())
    }
}

pub(super) fn string<'a>(value: &'a Value, key: &str, max: usize) -> Option<&'a str> {
    value
        .get(key)?
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= max)
}
