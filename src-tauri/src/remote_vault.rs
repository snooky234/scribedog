//! The desktop app as a client of a ScribeDog server.
//!
//! The webview cannot talk to a server the user typed in: its content
//! security policy confines `fetch` to the app itself, and the http plugin's
//! allowlist is fixed at build time. So the requests are made here, with the
//! same rule the filesystem follows: the frontend may only reach what the
//! user explicitly added (`allow_remote_vault_origin`, the counterpart of
//! `allow_folder_scope`). The allowlist is in memory and rebuilt by the
//! frontend at every start from its list of servers.
//!
//! TLS trusts the operating system's certificate store (`rustls` with native
//! roots), so a home server behind Caddy's own CA works as soon as that root
//! certificate is installed the way it is for the browser. There is no switch
//! to turn verification off.
//!
//! Live updates are a WebSocket to the server's event stream, kept here for
//! the same reason as the requests. It reports changes through the same event
//! as the native folder watcher, with the vault's virtual root as the folder
//! path, so the frontend cannot tell the two apart.

use std::{collections::HashSet, sync::Mutex, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message};

use crate::{FolderWatchState, FOLDER_FILES_CHANGED_EVENT, KEYRING_SERVICE};

/// Emitted with the vault root when the server refuses the token on the live
/// connection: the one moment an idle app learns that its key was revoked.
const REMOTE_VAULT_UNAUTHORIZED_EVENT: &str = "scribedog-remote-vault-unauthorized";

/// Emitted with the vault root and the reason when a shared vault's stream is
/// closed for good: the person was taken off the vault, or it was deleted.
const REMOTE_VAULT_ACCESS_LOST_EVENT: &str = "scribedog-remote-vault-access-lost";

/// Emitted with the vault root and the other people's open notes, for the
/// presence hints of a shared vault.
const REMOTE_VAULT_PRESENCE_EVENT: &str = "scribedog-remote-vault-presence";

/// Close codes of the server's event stream (server/src/vault/eventRoutes.ts).
const ACCESS_REMOVED_CLOSE_CODE: u16 = 4003;
const VAULT_DELETED_CLOSE_CODE: u16 = 4004;

const RECONNECT_MIN: Duration = Duration::from_secs(1);
const RECONNECT_MAX: Duration = Duration::from_secs(30);

pub struct RemoteVaultState {
    allowed_origins: Mutex<HashSet<String>>,
    client: reqwest::Client,
    watch: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// The note the open shared vault is showing, sent on every (re)connect
    /// so the other people see it. `None` means no note, or no shared vault.
    presence: Mutex<Option<watch::Sender<Option<String>>>>,
}

impl Default for RemoteVaultState {
    fn default() -> Self {
        Self {
            allowed_origins: Mutex::new(HashSet::new()),
            client: reqwest::Client::builder()
                .use_rustls_tls()
                .build()
                .expect("reqwest client"),
            watch: Mutex::new(None),
            presence: Mutex::new(None),
        }
    }
}

/// `scheme://host[:port]` with the default port left out, matching what the
/// frontend computes with `new URL(...).origin`.
fn origin_of(url: &reqwest::Url) -> String {
    url.origin().ascii_serialization()
}

fn ensure_allowed(state: &RemoteVaultState, url: &reqwest::Url) -> Result<(), String> {
    let origin = origin_of(url);
    let allowed = state
        .allowed_origins
        .lock()
        .map_err(|_| "allowlist poisoned".to_string())?;

    if allowed.contains(&origin) {
        Ok(())
    } else {
        Err(format!("{origin} is not a server this app was told about."))
    }
}

#[tauri::command]
pub fn allow_remote_vault_origin(state: State<'_, RemoteVaultState>, origin: String) -> Result<(), String> {
    let url = reqwest::Url::parse(&origin).map_err(|error| error.to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https servers are supported.".to_string());
    }

    state
        .allowed_origins
        .lock()
        .map_err(|_| "allowlist poisoned".to_string())?
        .insert(origin_of(&url));

    Ok(())
}

#[derive(Deserialize)]
pub struct RemoteRequest {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    /// Base64 of the body bytes; the IPC would otherwise ship a byte array as
    /// a JSON list of numbers.
    body: Option<String>,
}

#[derive(Serialize)]
pub struct RemoteResponse {
    status: u16,
    headers: Vec<(String, String)>,
    /// Base64 of the body bytes.
    body: String,
}

#[tauri::command]
pub async fn remote_vault_request(
    state: State<'_, RemoteVaultState>,
    request: RemoteRequest,
) -> Result<RemoteResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| error.to_string())?;
    ensure_allowed(&state, &url)?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|error| error.to_string())?;
    let mut builder = state.client.request(method, url);

    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }

    if let Some(body) = request.body {
        let bytes = BASE64.decode(body).map_err(|error| error.to_string())?;
        builder = builder.body(bytes);
    }

    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| (name.to_string(), value.to_string())))
        .collect();
    let body = response.bytes().await.map_err(|error| error.to_string())?;

    Ok(RemoteResponse {
        status,
        headers,
        body: BASE64.encode(body),
    })
}

// Tokens live next to the API keys in the OS credential store, under their
// own account name so the two namespaces never meet.
fn token_entry(vault_root: &str) -> Result<keyring::Entry, String> {
    let account = format!("remote-vault-token:{vault_root}");
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn store_remote_vault_token(vault_root: String, token: String) -> Result<(), String> {
    token_entry(&vault_root)?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_remote_vault_token(vault_root: String) -> Result<Option<String>, String> {
    match token_entry(&vault_root)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_remote_vault_token(vault_root: String) -> Result<(), String> {
    match token_entry(&vault_root)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Ends the live connection, if any. Also called by `watch_folder` when a
/// local folder takes over, so only one vault is ever watched.
pub fn stop_watch(state: &RemoteVaultState) {
    if let Ok(mut watch) = state.watch.lock() {
        if let Some(task) = watch.take() {
            task.abort();
        }
    }

    if let Ok(mut presence) = state.presence.lock() {
        presence.take();
    }
}

/// The note the open shared vault is showing, for the other people's presence
/// hints. Dropped silently when no vault is watched: the frontend reports the
/// open note whenever it changes, including before a watch has started.
#[tauri::command]
pub fn set_remote_vault_presence(state: State<'_, RemoteVaultState>, path: Option<String>) -> Result<(), String> {
    if let Ok(presence) = state.presence.lock() {
        if let Some(sender) = presence.as_ref() {
            let _ = sender.send(path);
        }
    }

    Ok(())
}

fn is_files_changed(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| value.get("type").and_then(|kind| kind.as_str()).map(|kind| kind == "files-changed"))
        .unwrap_or(false)
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// One connection attempt; see `connect_tcp` for why the socket is opened by hand.
async fn connect(events_url: &str, request: tokio_tungstenite::tungstenite::handshake::client::Request) -> Result<WsStream, WsError> {
    let url = reqwest::Url::parse(events_url).map_err(|_| WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::NoHostName))?;
    let stream = connect_tcp(&url).await?;
    let (stream, _) = tokio_tungstenite::client_async_tls(request, stream).await?;

    Ok(stream)
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Opens the TCP connection for the handshake. Done by hand rather than by
/// `connect_async`, which tries the resolved addresses one after the other
/// with no time limit: on Windows "localhost" resolves to the IPv6 loopback
/// first, and a connection there can sit for seconds before it fails when
/// the server only listens on IPv4. IPv4 goes first here, and no address
/// gets more than `CONNECT_TIMEOUT`.
async fn connect_tcp(url: &reqwest::Url) -> Result<tokio::net::TcpStream, WsError> {
    let host = url
        .host_str()
        .ok_or(WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::NoHostName))?;
    let port = url
        .port_or_known_default()
        .ok_or(WsError::Url(tokio_tungstenite::tungstenite::error::UrlError::UnsupportedUrlScheme))?;
    let mut addresses: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(WsError::Io)?
        .collect();
    addresses.sort_by_key(|address| address.is_ipv6());

    let mut last_error = std::io::Error::new(std::io::ErrorKind::NotFound, "no address");

    for address in addresses {
        match tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(address)).await {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(error)) => last_error = error,
            Err(_) => {
                last_error = std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timed out");
            }
        }
    }

    Err(WsError::Io(last_error))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessLostPayload {
    vault_root: String,
    /// "removed" (taken off the vault) or "deleted" (the vault is gone).
    reason: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresencePayload {
    vault_root: String,
    /// The server's entries as they came: `[{ "user": "...", "path": "..." }]`.
    editors: serde_json::Value,
}

/// The other people's open notes from a presence message, or `None` for any
/// other message.
fn presence_editors(text: &str) -> Option<serde_json::Value> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;

    if value.get("type").and_then(|kind| kind.as_str()) != Some("presence") {
        return None;
    }

    value.get("editors").filter(|editors| editors.is_array()).cloned()
}

fn presence_message(path: Option<&str>) -> Message {
    Message::Text(
        serde_json::json!({ "type": "presence", "path": path })
            .to_string()
            .into(),
    )
}

async fn run_watch(
    app: AppHandle,
    vault_root: String,
    events_url: String,
    token: String,
    mut presence: watch::Receiver<Option<String>>,
) {
    let mut delay = RECONNECT_MIN;

    loop {
        // Rebuilt per attempt: the handshake consumes the request.
        let Ok(mut request) = events_url.as_str().into_client_request() else {
            return;
        };
        let Ok(authorization) = HeaderValue::from_str(&format!("Bearer {token}")) else {
            return;
        };
        request.headers_mut().insert("authorization", authorization);

        match connect(&events_url, request).await {
            Ok(stream) => {
                delay = RECONNECT_MIN;
                let (mut outgoing, mut incoming) = stream.split();

                // The open note goes out on every (re)connect, and again
                // whenever the frontend reports another one.
                presence.mark_changed();

                loop {
                    tokio::select! {
                        changed = presence.changed() => {
                            if changed.is_err() {
                                return;
                            }

                            let path = presence.borrow_and_update().clone();

                            if outgoing.send(presence_message(path.as_deref())).await.is_err() {
                                break;
                            }
                        }
                        message = incoming.next() => {
                            let Some(message) = message else {
                                break;
                            };

                            match message {
                                Ok(Message::Text(text)) => {
                                    if is_files_changed(&text) {
                                        let _ = app.emit(FOLDER_FILES_CHANGED_EVENT, &vault_root);
                                    } else if let Some(editors) = presence_editors(&text) {
                                        let _ = app.emit(
                                            REMOTE_VAULT_PRESENCE_EVENT,
                                            PresencePayload { vault_root: vault_root.clone(), editors },
                                        );
                                    }
                                }
                                // A shared vault the person may no longer open:
                                // reconnecting would only be refused again.
                                Ok(Message::Close(Some(frame))) => {
                                    let code = u16::from(frame.code);
                                    let reason = match code {
                                        ACCESS_REMOVED_CLOSE_CODE => Some("removed"),
                                        VAULT_DELETED_CLOSE_CODE => Some("deleted"),
                                        _ => None,
                                    };

                                    if let Some(reason) = reason {
                                        let _ = app.emit(
                                            REMOTE_VAULT_ACCESS_LOST_EVENT,
                                            AccessLostPayload { vault_root: vault_root.clone(), reason },
                                        );
                                        return;
                                    }

                                    break;
                                }
                                Ok(Message::Close(None)) | Err(_) => break,
                                _ => {}
                            }
                        }
                    }
                }
            }
            // A refused upgrade means the token is gone (revoked, or the
            // password changed). Retrying would only repeat the answer; the
            // frontend asks for the password and starts a new watch.
            Err(WsError::Http(response)) if response.status() == 401 => {
                let _ = app.emit(REMOTE_VAULT_UNAUTHORIZED_EVENT, &vault_root);
                return;
            }
            Err(_) => {}
        }

        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(RECONNECT_MAX);
    }
}

#[tauri::command]
pub fn watch_remote_vault(
    app: AppHandle,
    state: State<'_, RemoteVaultState>,
    folder_state: State<'_, FolderWatchState>,
    vault_root: String,
    events_url: String,
    token: String,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&events_url).map_err(|error| error.to_string())?;

    // The allowlist is by origin, and the socket's origin is the server's
    // with the scheme swapped; check the http form the user added.
    let mut http_url = url.clone();
    let scheme = match url.scheme() {
        "wss" => "https",
        "ws" => "http",
        other => return Err(format!("Unsupported scheme {other}.")),
    };
    http_url.set_scheme(scheme).map_err(|_| "Unsupported scheme.".to_string())?;
    ensure_allowed(&state, &http_url)?;

    // Only one vault is open at a time: a local watcher, if any, ends here.
    if let Ok(mut watcher) = folder_state.watcher.lock() {
        watcher.take();
    }

    stop_watch(&state);

    let (presence_sender, presence_receiver) = watch::channel(None);
    *state.presence.lock().map_err(|_| "presence state poisoned".to_string())? = Some(presence_sender);

    let task = tauri::async_runtime::spawn(run_watch(app, vault_root, events_url, token, presence_receiver));

    *state.watch.lock().map_err(|_| "watch state poisoned".to_string())? = Some(task);

    Ok(())
}
