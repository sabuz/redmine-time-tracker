//! Sign-in for a Redmine that sits behind Pomerium (an identity-aware proxy).
//!
//! Pomerium's "programmatic access" flow, as documented at
//! https://pomerium.com/docs/internals/programmatic-access:
//!   1. ask `<pomerium host>/.pomerium/api/v1/login?pomerium_redirect_uri=<callback>` for a sign-in URL,
//!   2. the user completes the normal login in their browser,
//!   3. Pomerium redirects the browser to our localhost callback with `?pomerium_jwt=<token>`,
//!   4. every later request carries `Authorization: Pomerium <token>`.

use std::time::Duration;

use reqwest::{redirect::Policy, Url};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::redmine::Result;

const WAIT_FOR_BROWSER: Duration = Duration::from_secs(180);

/// Runs the browser sign-in and returns the session token. `open` is handed the
/// sign-in URL and should show it to the user (the app opens their browser;
/// tests follow the redirects themselves). Dropping or firing `cancel` aborts.
pub async fn pomerium_login(
    base: &str,
    open: impl FnOnce(&str) -> Result<()>,
    cancel: oneshot::Receiver<()>,
) -> Result<String> {
    // Listen before asking, so the callback can never arrive early.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Couldn't start the local sign-in listener: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let callback = format!("http://localhost:{port}/");

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    // Pomerium answers its login API on whichever host it serves. That is the
    // Redmine host when Pomerium is the proxy itself; behind nginx forward-auth
    // it is a separate Pomerium host, which a plain API request gets redirected to.
    let mut hosts = vec![base.to_string()];
    if let Some(other) = redirect_origin(&http, base).await {
        if !hosts.contains(&other) {
            hosts.push(other);
        }
    }
    let mut tried = Vec::new();
    let mut signin = None;
    for host in &hosts {
        match request_signin_url(&http, host, &callback).await {
            Ok(url) => {
                signin = Some(url);
                break;
            }
            Err(why) => tried.push(format!("{host}: {why}")),
        }
    }
    let Some(signin) = signin else {
        return Err(format!(
            "No Pomerium sign-in found ({}). If Pomerium isn't what protects Redmine, ask your admin how API access is meant to authenticate.",
            tried.join("; ")
        )
        .into());
    };

    open(&signin)?;

    tokio::select! {
        _ = cancel => Err("Sign-in cancelled.".into()),
        res = tokio::time::timeout(WAIT_FOR_BROWSER, wait_for_token(&listener)) => match res {
            Ok(token) => token,
            Err(_) => Err("Timed out waiting for the browser sign-in. Try again.".into()),
        },
    }
}

/// `GET <host>/.pomerium/api/v1/login?pomerium_redirect_uri=<callback>` → the URL to open.
async fn request_signin_url(http: &reqwest::Client, host: &str, callback: &str) -> std::result::Result<String, String> {
    let resp = http
        .get(format!("{host}/.pomerium/api/v1/login"))
        .query(&[("pomerium_redirect_uri", callback)])
        .send()
        .await
        .map_err(|e| format!("unreachable ({e})"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    let url = body.trim();
    if status.is_success() && Url::parse(url).is_ok() {
        Ok(url.to_string())
    } else {
        Err(format!("answered {status}"))
    }
}

/// Where an unauthenticated API request to `base` is sent (the origin of the
/// redirect's target), if that is a different site.
async fn redirect_origin(http: &reqwest::Client, base: &str) -> Option<String> {
    let resp = http
        .get(format!("{base}/users/current.json"))
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_redirection() {
        return None;
    }
    let location = resp.headers().get("location")?.to_str().ok()?;
    let target = Url::parse(base).ok()?.join(location).ok()?;
    let origin = target.origin().ascii_serialization();
    (origin != Url::parse(base).ok()?.origin().ascii_serialization()).then_some(origin)
}

/// Accepts connections until one carries `?pomerium_jwt=`; answers each with a
/// small page. Strays (favicon requests, port scanners) are ignored.
async fn wait_for_token(listener: &TcpListener) -> Result<String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let Some(target) = read_request_target(&mut stream).await else {
            continue;
        };
        let token = Url::parse(&format!("http://localhost{target}"))
            .ok()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "pomerium_jwt").map(|(_, v)| v.into_owned()))
            .filter(|t| !t.is_empty());
        let (status, message) = match token {
            Some(_) => ("200 OK", "You're signed in. You can close this tab and return to Redmine Time."),
            None => ("404 Not Found", "Nothing here."),
        };
        let page = format!(
            "<!doctype html><meta charset=utf-8><title>Redmine Time</title><body style=\"font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;color:#444\"><p>{message}</p>"
        );
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
            page.len()
        );
        let _ = stream.write_all(reply.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(token) = token {
            return Ok(token);
        }
    }
}

/// Reads up to the end of the request headers and returns the request target
/// ("/?pomerium_jwt=…" from "GET /?pomerium_jwt=… HTTP/1.1").
async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut data = Vec::new();
    let mut chunk = [0u8; 4096];
    let read = async {
        while data.len() < 64 * 1024 && !data.windows(4).any(|w| w == b"\r\n\r\n") {
            match stream.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => data.extend_from_slice(&chunk[..n]),
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(5), read).await.ok()?;
    let head = String::from_utf8_lossy(&data);
    let mut parts = head.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    parts.next().map(str::to_string)
}
