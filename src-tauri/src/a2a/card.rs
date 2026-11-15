use std::collections::HashSet;

use serde_json::{Map, Value};

use super::{
    contracts::{AgentInterface, AuthKind, Discovery, Issue},
    errors::error,
    store::Resolved,
    validation::{self, string},
};
use crate::terminal::AppError;

fn invalid() -> AppError {
    error(
        "A2A_INVALID_CARD",
        "The Agent Card does not have the required A2A 1.0 shape.",
    )
}
fn issue(code: &str, message: &str) -> Issue {
    Issue {
        code: code.into(),
        message: message.into(),
    }
}

pub(super) fn discover(card: Value, connection: &Resolved) -> Result<Discovery, AppError> {
    if !card.is_object()
        || string(&card, "name", 512).is_none()
        || string(&card, "description", 64 * 1024).is_none()
        || string(&card, "version", 128).is_none()
    {
        return Err(invalid());
    }
    let capabilities = card
        .get("capabilities")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    for name in ["streaming", "pushNotifications", "extendedAgentCard"] {
        if capabilities
            .get(name)
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(invalid());
        }
    }
    let inputs = string_list(card.get("defaultInputModes"), 64)?;
    let outputs = string_list(card.get("defaultOutputModes"), 64)?;
    let skills = card
        .get("skills")
        .and_then(Value::as_array)
        .filter(|list| list.len() <= 256)
        .ok_or_else(invalid)?;
    let mut skill_ids = HashSet::new();
    for skill in skills {
        let id = string(skill, "id", 512).ok_or_else(invalid)?;
        if !skill.is_object()
            || !skill_ids.insert(id)
            || string(skill, "name", 512).is_none()
            || string(skill, "description", 64 * 1024).is_none()
        {
            return Err(invalid());
        }
        string_list(skill.get("tags"), 128)?;
        for name in ["examples", "inputModes", "outputModes"] {
            if skill.get(name).is_some() {
                string_list(skill.get(name), 128)?;
            }
        }
    }
    let declared = card
        .get("supportedInterfaces")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= 64)
        .ok_or_else(invalid)?;
    let mut interfaces = vec![];
    for item in declared {
        if !item.is_object() {
            continue;
        }
        // One malformed or unsupported entry must not poison an otherwise usable
        // card. Only JSONRPC/1.0 entries are candidates; invalid candidates are
        // skipped so the caller sees NO_COMPATIBLE_INTERFACE instead of
        // A2A_INVALID_CARD when none remain.
        let Some(binding) = string(item, "protocolBinding", 64) else {
            continue;
        };
        let Some(version) = string(item, "protocolVersion", 64) else {
            continue;
        };
        if binding != "JSONRPC" || version != "1.0" {
            continue;
        }
        let Some(address) = string(item, "url", 4096) else {
            continue;
        };
        let Ok(url) = validation::url(address) else {
            continue;
        };
        let tenant = match item.get("tenant") {
            None => None,
            Some(value) => match value.as_str().filter(|s| !s.is_empty() && s.len() <= 512) {
                Some(tenant) => Some(tenant.to_owned()),
                None => continue,
            },
        };
        interfaces.push(AgentInterface {
            url: url.to_string(),
            protocol_binding: binding.into(),
            protocol_version: version.into(),
            tenant,
        });
    }
    let selected = match &connection.info.interface_url {
        Some(url) => interfaces
            .iter()
            .find(|interface| {
                &interface.url == url
                    && connection
                        .info
                        .interface_tenant
                        .as_deref()
                        .is_none_or(|tenant| interface.tenant.as_deref() == Some(tenant))
            })
            .cloned(),
        None => interfaces.first().cloned(),
    };
    let mut problem = if selected.is_none() {
        Some(issue(
            "A2A_NO_COMPATIBLE_INTERFACE",
            "The card does not offer the selected JSONRPC / 1.0 interface.",
        ))
    } else {
        None
    };
    let mut selected = selected;
    if connection.info.interface_url.is_none() {
        if let Some(interface) = &selected {
            let card_origin = validation::origin(&validation::url(&connection.info.card_url)?);
            if validation::origin(&validation::url(&interface.url)?) != card_origin {
                selected = None;
                problem = Some(issue(
                    "A2A_INTERFACE_SELECTION_REQUIRED",
                    "The interface has a different origin. Select it explicitly before sending credentials or messages.",
                ));
            }
        }
    }
    if let Some(extensions) = capabilities.get("extensions") {
        let extensions = extensions
            .as_array()
            .filter(|items| items.len() <= 64)
            .ok_or_else(invalid)?;
        for extension in extensions {
            if !extension.is_object()
                || string(extension, "uri", 4096).is_none()
                || extension
                    .get("required")
                    .is_some_and(|value| !value.is_boolean())
            {
                return Err(invalid());
            }
            if extension["required"] == true && problem.is_none() {
                problem = Some(issue(
                    "A2A_REQUIRED_EXTENSION_UNSUPPORTED",
                    "This card requires an extension the Belfry client does not implement.",
                ));
            }
        }
    }
    if !inputs.iter().any(|mode| accepts(mode, "text/plain"))
        || !outputs
            .iter()
            .any(|mode| accepts(mode, "text/plain") || accepts(mode, "application/json"))
    {
        if problem.is_none() {
            problem = Some(issue(
                "A2A_MODES_UNSUPPORTED",
                "This client requires text input and text or JSON output.",
            ));
        }
    }
    let empty = Map::new();
    let schemes = match card.get("securitySchemes") {
        None => &empty,
        Some(value) => value
            .as_object()
            .filter(|map| map.len() <= 64)
            .ok_or_else(invalid)?,
    };
    let auth_issue = security(card.get("securityRequirements"), schemes, connection)?;
    if problem.is_none() {
        problem = auth_issue;
    }
    // SendMessage has no standard skillId route. A skill-specific requirement
    // cannot be selected explicitly, so it must not make an otherwise usable
    // card unusable; the card-level requirement remains authoritative. Still
    // parse skill requirements so malformed cards are rejected.
    for skill in skills {
        let _ = security(skill.get("securityRequirements"), schemes, connection)?;
    }
    if connection.info.auth.kind != AuthKind::None
        && connection.secret.is_none()
        && problem.is_none()
    {
        problem = Some(issue(
            "A2A_AUTHENTICATION_REQUIRED",
            "Configure this connection's credential before calling the agent.",
        ));
    }
    if let Some(interface) = &selected {
        if connection.secret.is_some()
            && validation::origin(&validation::url(&interface.url)?) != connection.credential_origin
            && problem.is_none()
        {
            problem = Some(issue(
                "A2A_CREDENTIAL_ORIGIN_MISMATCH",
                "The selected interface does not match the configured credential origin.",
            ));
        }
    }
    Ok(Discovery {
        card,
        interfaces,
        selected_interface: selected,
        issue: problem,
    })
}

fn string_list(value: Option<&Value>, max: usize) -> Result<Vec<&str>, AppError> {
    let list = value
        .and_then(Value::as_array)
        .filter(|items| items.len() <= max)
        .ok_or_else(invalid)?;
    list.iter()
        .map(|value| {
            value
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 4096)
                .ok_or_else(invalid)
        })
        .collect()
}

fn accepts(mode: &str, wanted: &str) -> bool {
    mode == wanted || mode == "*/*" || (mode == "text/*" && wanted.starts_with("text/"))
}

pub(super) fn output_modes(card: &Value) -> Vec<&'static str> {
    ["text/plain", "application/json"]
        .into_iter()
        .filter(|wanted| {
            card["defaultOutputModes"].as_array().is_some_and(|modes| {
                modes
                    .iter()
                    .any(|mode| mode.as_str().is_some_and(|mode| accepts(mode, wanted)))
            })
        })
        .collect()
}

fn security(
    requirements: Option<&Value>,
    schemes: &Map<String, Value>,
    connection: &Resolved,
) -> Result<Option<Issue>, AppError> {
    let Some(requirements) = requirements else {
        return Ok(None);
    };
    let requirements = requirements
        .as_array()
        .filter(|items| items.len() <= 64)
        .ok_or_else(invalid)?;
    if requirements.is_empty() {
        return Ok(None);
    }
    let mut possible = false;
    let mut matched = false;
    for requirement in requirements {
        if !requirement.is_object() {
            return Err(invalid());
        }
        let empty = Map::new();
        let requested = match requirement.get("schemes") {
            None => &empty,
            Some(value) => value
                .as_object()
                .filter(|map| map.len() <= 64)
                .ok_or_else(invalid)?,
        };
        if requested.is_empty() {
            matched = true;
            continue;
        }
        let mut headers = HashSet::new();
        let mut supported = true;
        let mut match_all = connection.secret.is_some();
        for (name, scopes) in requested {
            if !scopes.is_object() {
                return Err(invalid());
            }
            let scopes = match scopes.get("list") {
                None => vec![],
                Some(value) => string_list(Some(value), 64)?,
            };
            let scheme = schemes
                .get(name)
                .and_then(Value::as_object)
                .ok_or_else(invalid)?;
            let variants = [
                "httpAuthSecurityScheme",
                "apiKeySecurityScheme",
                "oauth2SecurityScheme",
                "openIdConnectSecurityScheme",
                "mtlsSecurityScheme",
            ];
            if variants
                .iter()
                .filter(|name| scheme.contains_key(**name))
                .count()
                != 1
            {
                return Err(invalid());
            }
            if let Some(http) = scheme.get("httpAuthSecurityScheme") {
                let kind = string(http, "scheme", 128).ok_or_else(invalid)?;
                if !kind.eq_ignore_ascii_case("bearer") || !scopes.is_empty() {
                    supported = false;
                }
                headers.insert("authorization".to_owned());
                match_all &= connection.info.auth.kind == AuthKind::Bearer
                    && kind.eq_ignore_ascii_case("bearer");
            } else if let Some(api) = scheme.get("apiKeySecurityScheme") {
                let name = string(api, "name", 128).ok_or_else(invalid)?;
                let location = string(api, "location", 128).ok_or_else(invalid)?;
                let header = validation::header(name).ok();
                if location != "header" || header.is_none() || !scopes.is_empty() {
                    supported = false;
                }
                if let Some(header) = &header {
                    headers.insert(header.clone());
                }
                match_all &= location == "header"
                    && connection.info.auth.kind == AuthKind::ApiKey
                    && connection.info.auth.header_name == header;
            } else {
                supported = false;
                match_all = false;
            }
        }
        // The current connection can supply only one static credential/header.
        supported &= headers.len() <= 1;
        possible |= supported;
        matched |= supported && match_all;
    }
    if matched {
        Ok(None)
    } else if possible {
        Ok(Some(issue(
            "A2A_AUTHENTICATION_REQUIRED",
            "The configured credential does not satisfy the card or skill's authentication requirements.",
        )))
    } else {
        Ok(Some(issue(
            "A2A_AUTHENTICATION_UNSUPPORTED",
            "This card or skill requires an unsupported authentication flow or multiple credentials.",
        )))
    }
}
