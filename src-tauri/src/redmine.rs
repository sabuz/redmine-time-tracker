//! Thin client for the parts of the Redmine REST API a timesheet needs.
//!
//! Everything returned to the frontend is a flat, camelCase struct so the UI
//! never has to know Redmine's nested JSON shapes.

use std::collections::HashMap;
use std::error::Error as StdError;
use std::time::Duration;

use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub type Result<T> = std::result::Result<T, Error>;

/// Errors cross to the frontend as `{ kind, message }`. `Sso` is the one the UI
/// reacts to: a proxy in front of Redmine (Pomerium) wants a company sign-in.
#[derive(Debug, Clone)]
pub enum Error {
    Message(String),
    Sso,
}

pub const SSO_MESSAGE: &str = "Your company sign-in (Pomerium) is needed or has expired. Sign in with your browser to continue.";

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Message(m) => f.write_str(m),
            Error::Sso => f.write_str(SSO_MESSAGE),
        }
    }
}

impl From<String> for Error {
    fn from(m: String) -> Self {
        Error::Message(m)
    }
}

impl From<&str> for Error {
    fn from(m: &str) -> Self {
        Error::Message(m.to_string())
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Wire {
            kind: &'static str,
            message: String,
        }
        Wire { kind: if matches!(self, Error::Sso) { "sso" } else { "error" }, message: self.to_string() }.serialize(s)
    }
}

type Query = [(&'static str, String)];

fn kv(key: &'static str, value: impl ToString) -> (&'static str, String) {
    (key, value.to_string())
}

// ---------------------------------------------------------------- types ----

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u64,
    pub login: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    pub issue_id: Option<u64>,
    pub issue_subject: Option<String>,
    pub project_id: Option<u64>,
    pub project_name: String,
    pub activity_id: Option<u64>,
    pub activity_name: String,
    pub hours: f64,
    pub comments: String,
    pub spent_on: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IssueHit {
    pub id: u64,
    pub subject: String,
    pub project_id: Option<u64>,
    pub project_name: String,
    pub tracker: String,
    pub status: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: u64,
    pub name: String,
    pub is_default: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    pub issue_id: u64,
    pub project_id: Option<u64>,
    pub spent_on: String,
    pub hours: f64,
    #[serde(default)]
    pub comments: String,
    pub activity_id: Option<u64>,
}

// --------------------------------------------------------------- helpers ----

/// Accepts "redmine.example.com", "https://host/redmine/" etc. and returns a
/// base URL without a trailing slash.
pub fn normalize_url(input: &str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter your Redmine URL.".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| "That doesn't look like a valid URL.".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("The URL must start with http:// or https://".into());
    }
    let Some(host) = url.host_str() else {
        return Err("That doesn't look like a valid URL.".into());
    };

    // People paste whatever page they're on ("…/my/page", "…/projects/x/issues").
    // Keep only the part before the first Redmine page segment, so installs under
    // a sub-path ("https://host/redmine") still work.
    let mut base = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        base.push_str(&format!(":{port}"));
    }
    for segment in url.path_segments().into_iter().flatten() {
        if segment.is_empty() || PAGE_SEGMENTS.contains(&segment) {
            break;
        }
        base.push('/');
        base.push_str(segment);
    }
    Ok(base)
}

const PAGE_SEGMENTS: &[&str] =
    &["my", "login", "logout", "account", "projects", "issues", "time_entries", "users", "admin", "settings", "search"];

/// Hours are logged in quarter-hour steps.
fn check_hours(hours: f64) -> Result<f64> {
    let snapped = (hours * 4.0).round() / 4.0;
    if !snapped.is_finite() || snapped <= 0.0 || snapped > 24.0 {
        return Err("Hours must be between 0.25 and 24.".into());
    }
    Ok(snapped)
}

/// Did the request end up on a different origin than the one we asked? That is
/// what a sign-in redirect from a proxy in front of Redmine looks like.
fn left_origin(base: &str, final_url: &Url) -> bool {
    Url::parse(base).map(|b| b.origin() != final_url.origin()).unwrap_or(false)
}

/// The server answered 2xx but not with JSON. Say what it did answer with, so
/// the cause (login page, wrong path…) is visible to the user.
fn not_json_error(final_url: &Url, content_type: &str, body: &str) -> String {
    let kind = if content_type.is_empty() { "something that isn't JSON" } else { content_type };
    let lower = body.to_lowercase();
    let hint = if final_url.path().contains("login") || (lower.contains("type=\"password\"") && lower.contains("<form")) {
        "Redmine sent back its sign-in page instead of data. Check that the REST API is enabled (Administration → Settings → API) and that this is the Redmine root address."
    } else {
        "Check that the URL is the Redmine root (for example https://host or https://host/redmine) and that the REST API is enabled."
    };
    format!("{hint} (Got {kind} from {final_url}.)")
}

fn network_error(base: &str, e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return format!("{base} took too long to respond.");
    }
    let mut root: &dyn StdError = e;
    while let Some(next) = root.source() {
        root = next;
    }
    if e.is_connect() {
        format!("Can't connect to {base} ({root}).")
    } else {
        format!("Request to {base} failed: {root}")
    }
}

fn http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED => "Redmine rejected the API key. Check the key, and that the REST API is enabled (Administration → Settings → API).".into(),
        StatusCode::FORBIDDEN => "Redmine refused the request (403). Either the REST API is switched off (Administration → Settings → API), or your role is missing a permission such as “Edit own spent time”.".into(),
        StatusCode::NOT_FOUND => "Not found. Check the URL and that the REST API is enabled.".into(),
        StatusCode::UNPROCESSABLE_ENTITY => serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|v| {
                v["errors"].as_array().map(|a| {
                    a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")
                })
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Redmine rejected the request (422).".into()),
        s => format!("Redmine returned {s}."),
    }
}

fn str_of(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn parse_user(v: &Value) -> Option<User> {
    let first = v["firstname"].as_str().unwrap_or_default();
    let last = v["lastname"].as_str().unwrap_or_default();
    let login = str_of(&v["login"]);
    let name = format!("{first} {last}").trim().to_string();
    Some(User {
        id: v["id"].as_u64()?,
        name: if name.is_empty() { login.clone() } else { name },
        login,
    })
}

fn parse_entry(v: &Value) -> Option<Entry> {
    Some(Entry {
        id: v["id"].as_u64()?,
        issue_id: v["issue"]["id"].as_u64(),
        issue_subject: None,
        project_id: v["project"]["id"].as_u64(),
        project_name: str_of(&v["project"]["name"]),
        activity_id: v["activity"]["id"].as_u64(),
        activity_name: str_of(&v["activity"]["name"]),
        hours: v["hours"].as_f64().unwrap_or(0.0),
        comments: str_of(&v["comments"]),
        spent_on: v["spent_on"].as_str()?.to_string(),
    })
}

fn parse_issue(v: &Value) -> Option<IssueHit> {
    Some(IssueHit {
        id: v["id"].as_u64()?,
        subject: str_of(&v["subject"]),
        project_id: v["project"]["id"].as_u64(),
        project_name: str_of(&v["project"]["name"]),
        tracker: str_of(&v["tracker"]["name"]),
        status: str_of(&v["status"]["name"]),
    })
}

fn parse_activities(v: &Value) -> Vec<Activity> {
    v.as_array()
        .map(|items| {
            items
                .iter()
                .filter(|a| a["active"].as_bool().unwrap_or(true))
                .filter_map(|a| {
                    Some(Activity {
                        id: a["id"].as_u64()?,
                        name: str_of(&a["name"]),
                        is_default: a["is_default"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------- client ----

#[derive(Clone)]
pub struct Redmine {
    http: Client,
    base: String,
    key: String,
    /// Session token from a Pomerium sign-in, when Redmine sits behind one.
    sso: Option<String>,
}

impl Redmine {
    pub fn new(base: &str, key: &str, sso: Option<String>) -> Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("redmine-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { http, base: base.to_string(), key: key.to_string(), sso })
    }

    async fn send(&self, method: Method, path: &str, query: &Query, body: Option<Value>) -> Result<Value> {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .header("X-Redmine-API-Key", &self.key)
            .header("Accept", "application/json")
            .query(query);
        if let Some(token) = &self.sso {
            req = req.header("Authorization", format!("Pomerium {token}"));
        }
        if let Some(body) = body {
            req = req.json(&body);
        }
        let resp = req.send().await.map_err(|e| network_error(&self.base, &e))?;
        let status = resp.status();
        let final_url = resp.url().clone();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let text = resp.text().await.map_err(|e| network_error(&self.base, &e))?;
        let is_html = content_type.contains("html");
        if !status.is_success() {
            // A proxy's own "unauthorized" page, or a redirect to its identity provider.
            if left_origin(&self.base, &final_url) || (is_html && text.to_lowercase().contains("pomerium")) {
                return Err(Error::Sso);
            }
            return Err(http_error(status, &text).into());
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|_| {
            if left_origin(&self.base, &final_url) {
                Error::Sso
            } else {
                not_json_error(&final_url, &content_type, &text).into()
            }
        })
    }

    async fn get(&self, path: &str, query: &Query) -> Result<Value> {
        self.send(Method::GET, path, query, None).await
    }

    pub async fn current_user(&self) -> Result<User> {
        let v = self.get("/users/current.json", &[]).await?;
        parse_user(&v["user"]).ok_or_else(|| Error::from("Unexpected response from Redmine."))
    }

    /// All of the user's time entries between two dates (inclusive), with the
    /// issue subject filled in (Redmine only returns the issue id).
    pub async fn time_entries(&self, user_id: u64, from: &str, to: &str) -> Result<Vec<Entry>> {
        let mut out = Vec::new();
        let mut offset = 0usize;
        loop {
            let v = self
                .get(
                    "/time_entries.json",
                    &[
                        kv("user_id", user_id),
                        kv("from", from),
                        kv("to", to),
                        kv("limit", 100),
                        kv("offset", offset),
                    ],
                )
                .await?;
            let items = v["time_entries"].as_array().cloned().unwrap_or_default();
            let total = v["total_count"].as_u64().unwrap_or(0) as usize;
            offset += items.len();
            out.extend(items.iter().filter_map(parse_entry));
            if items.is_empty() || offset >= total {
                break;
            }
        }
        self.attach_subjects(&mut out).await;
        Ok(out)
    }

    /// Best effort: an issue the user can't see just keeps its bare id.
    async fn attach_subjects(&self, entries: &mut [Entry]) {
        let mut ids: Vec<u64> = entries.iter().filter_map(|e| e.issue_id).collect();
        ids.sort_unstable();
        ids.dedup();

        let mut subjects: HashMap<u64, String> = HashMap::new();
        for chunk in ids.chunks(50) {
            let joined = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
            let res = self
                .get(
                    "/issues.json",
                    &[kv("issue_id", joined), kv("status_id", "*"), kv("limit", 100)],
                )
                .await;
            if let Ok(v) = res {
                for issue in v["issues"].as_array().into_iter().flatten() {
                    if let Some(id) = issue["id"].as_u64() {
                        subjects.insert(id, str_of(&issue["subject"]));
                    }
                }
            }
        }
        for e in entries {
            e.issue_subject = e.issue_id.and_then(|id| subjects.get(&id).cloned());
        }
    }

    /// Find issues to log time against. A number looks up that exact issue
    /// (listed first) and also searches subjects; an empty query suggests the
    /// user's open assigned issues.
    pub async fn search_issues(&self, query: &str) -> Result<Vec<IssueHit>> {
        let q = query.trim().trim_start_matches('#').trim();
        let mut hits: Vec<IssueHit> = Vec::new();

        if let Ok(id) = q.parse::<u64>() {
            if let Ok(v) = self.get(&format!("/issues/{id}.json"), &[]).await {
                hits.extend(parse_issue(&v["issue"]));
            }
        }

        let list = if q.is_empty() {
            self.get(
                "/issues.json",
                &[kv("assigned_to_id", "me"), kv("status_id", "open"), kv("limit", 25), kv("sort", "updated_on:desc")],
            )
            .await?
        } else {
            self.get(
                "/issues.json",
                &[kv("subject", format!("~{q}")), kv("status_id", "*"), kv("limit", 20), kv("sort", "updated_on:desc")],
            )
            .await?
        };
        for issue in list["issues"].as_array().into_iter().flatten() {
            if let Some(hit) = parse_issue(issue) {
                if !hits.iter().any(|h| h.id == hit.id) {
                    hits.push(hit);
                }
            }
        }
        Ok(hits)
    }

    /// Activities the user can pick for a project, falling back to the global
    /// list. Never fails: if Redmine is too old to list them, the server-side
    /// default applies.
    pub async fn activities(&self, project_id: Option<u64>) -> Vec<Activity> {
        let global = match self.get("/enumerations/time_entry_activities.json", &[]).await {
            Ok(v) => parse_activities(&v["time_entry_activities"]),
            Err(_) => Vec::new(),
        };
        if let Some(pid) = project_id {
            let res = self
                .get(&format!("/projects/{pid}.json"), &[kv("include", "time_entry_activities")])
                .await;
            if let Ok(v) = res {
                let mut list = parse_activities(&v["project"]["time_entry_activities"]);
                if !list.is_empty() {
                    let default_name = global.iter().find(|a| a.is_default).map(|a| a.name.clone());
                    for a in &mut list {
                        if !a.is_default {
                            a.is_default = default_name.as_deref() == Some(a.name.as_str());
                        }
                    }
                    return list;
                }
            }
        }
        global
    }

    async fn default_activity(&self, project_id: Option<u64>) -> Option<u64> {
        let list = self.activities(project_id).await;
        list.iter().find(|a| a.is_default).or_else(|| list.first()).map(|a| a.id)
    }

    pub async fn create_entry(&self, new: NewEntry) -> Result<Entry> {
        let hours = check_hours(new.hours)?;
        let activity = match new.activity_id {
            Some(a) => Some(a),
            None => self.default_activity(new.project_id).await,
        };
        let mut entry = json!({
            "issue_id": new.issue_id,
            "spent_on": new.spent_on,
            "hours": hours,
            "comments": new.comments,
        });
        if let Some(a) = activity {
            entry["activity_id"] = json!(a);
        }
        let v = self
            .send(Method::POST, "/time_entries.json", &[], Some(json!({ "time_entry": entry })))
            .await?;
        self.finish_entry(&v["time_entry"]).await
    }

    pub async fn update_entry(
        &self,
        id: u64,
        hours: Option<f64>,
        comments: Option<String>,
        activity_id: Option<u64>,
    ) -> Result<Entry> {
        let mut fields = Map::new();
        if let Some(h) = hours {
            fields.insert("hours".into(), json!(check_hours(h)?));
        }
        if let Some(c) = comments {
            fields.insert("comments".into(), json!(c));
        }
        if let Some(a) = activity_id {
            fields.insert("activity_id".into(), json!(a));
        }
        let path = format!("/time_entries/{id}.json");
        self.send(Method::PUT, &path, &[], Some(json!({ "time_entry": fields }))).await?;
        // PUT answers 204 with no body, so read the entry back.
        let v = self.get(&path, &[]).await?;
        self.finish_entry(&v["time_entry"]).await
    }

    pub async fn delete_entry(&self, id: u64) -> Result<()> {
        self.send(Method::DELETE, &format!("/time_entries/{id}.json"), &[], None).await?;
        Ok(())
    }

    async fn finish_entry(&self, raw: &Value) -> Result<Entry> {
        let mut entry = parse_entry(raw).ok_or_else(|| "Unexpected response from Redmine.".to_string())?;
        self.attach_subjects(std::slice::from_mut(&mut entry)).await;
        Ok(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls() {
        assert_eq!(normalize_url("redmine.example.com").unwrap(), "https://redmine.example.com");
        assert_eq!(normalize_url(" http://host:3000/ ").unwrap(), "http://host:3000");
        assert_eq!(normalize_url("https://example.com/redmine///").unwrap(), "https://example.com/redmine");
        assert_eq!(normalize_url("https://host/my/page").unwrap(), "https://host");
        assert_eq!(normalize_url("https://host/redmine/projects/x/issues?set_filter=1#a").unwrap(), "https://host/redmine");
        assert_eq!(normalize_url("host:3000/login?back_url=/").unwrap(), "https://host:3000");
        assert!(normalize_url("").is_err());
        assert!(normalize_url("ftp://example.com").is_err());
    }

    #[test]
    fn explains_non_json_answers() {
        let u = |s: &str| Url::parse(s).unwrap();
        let login = not_json_error(&u("https://rm.corp.com/login"), "text/html", "<html>");
        assert!(login.contains("sign-in page"), "{login}");
        let other = not_json_error(&u("https://rm.corp.com/"), "text/html", "<html>welcome");
        assert!(other.contains("Redmine root") && other.contains("text/html"), "{other}");
    }

    /// A tiny local HTTP server. `handler(target, headers)` gets the request target
    /// and the lower-cased header block, and returns the full raw response.
    fn spawn_server(handler: impl Fn(&str, &str) -> String + Send + 'static) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let headers = request.split_once("\r\n").map(|(_, h)| h.to_lowercase()).unwrap_or_default();
                let _ = stream.write_all(handler(&target, &headers).as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn http(status: &str, headers: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn html_page(body: &str) -> String {
        http("200 OK", "Content-Type: text/html\r\n", body)
    }

    #[tokio::test]
    async fn reports_what_a_non_redmine_server_returned() {
        let page = spawn_server(|_, _| html_page("<form><input type=\"password\"></form>"));
        let err = Redmine::new(&page, "k", None).unwrap().current_user().await.unwrap_err().to_string();
        assert!(err.contains("sign-in page") && err.contains("text/html") && err.contains("/users/current.json"), "{err}");
    }

    /// Stands in for Redmine behind Pomerium, following the documented
    /// programmatic-access flow: sign-in URL endpoint, browser redirect back to the
    /// caller's localhost callback with `pomerium_jwt`, then `Authorization: Pomerium`.
    fn fake_pomerium() -> String {
        let google = spawn_server(|_, _| html_page("<title>Sign in - Google Accounts</title>"));
        spawn_server(move |target, headers| {
            let host = headers.lines().find_map(|l| l.strip_prefix("host: ")).unwrap_or("").trim().to_string();
            let url = Url::parse(&format!("http://{host}{target}")).unwrap();
            let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned()).unwrap_or_default();
            match url.path() {
                "/.pomerium/api/v1/login" => http("200 OK", "Content-Type: text/plain\r\n", &format!("http://{host}/signin?r={}", param("pomerium_redirect_uri"))),
                "/signin" => http("302 Found", &format!("Location: {}?pomerium_jwt=tok123\r\n", param("r")), ""),
                "/users/current.json" if headers.contains("authorization: pomerium tok123") => http(
                    "200 OK",
                    "Content-Type: application/json\r\n",
                    r#"{"user":{"id":5,"login":"alex","firstname":"Alex","lastname":"Rivera"}}"#,
                ),
                "/users/current.json" => http("302 Found", &format!("Location: {google}/signin\r\n"), ""),
                _ => http("404 Not Found", "", ""),
            }
        })
    }

    /// Plays the browser: follows the sign-in URL, which ends at our callback.
    fn follow_in_background(signin: &str) -> Result<()> {
        let url = signin.to_string();
        tokio::spawn(async move {
            let _ = reqwest::get(url).await;
        });
        Ok(())
    }

    #[tokio::test]
    async fn pomerium_sign_in_end_to_end() {
        let base = fake_pomerium();

        // Without a token the proxy bounces us to its identity provider.
        let err = Redmine::new(&base, "k", None).unwrap().current_user().await.unwrap_err();
        assert!(matches!(err, Error::Sso), "{err}");

        // The browser flow yields the token…
        let (_keep, rx) = tokio::sync::oneshot::channel();
        let token = crate::sso::pomerium_login(&base, follow_in_background, rx).await.unwrap();
        assert_eq!(token, "tok123");

        // …which gets us through; a stale one doesn't.
        let me = Redmine::new(&base, "k", Some(token)).unwrap().current_user().await.unwrap();
        assert_eq!(me.name, "Alex Rivera");
        let err = Redmine::new(&base, "k", Some("old".into())).unwrap().current_user().await.unwrap_err();
        assert!(matches!(err, Error::Sso), "{err}");
    }

    /// nginx forward-auth layout: Redmine's host only redirects unauthenticated API
    /// calls to a separate Pomerium host, and has no `/.pomerium/` paths of its own
    /// (they fall through to Redmine and 404). The login API lives on the Pomerium host.
    #[tokio::test]
    async fn pomerium_sign_in_behind_nginx_forward_auth() {
        let pomerium = spawn_server(|target, headers| {
            let host = headers.lines().find_map(|l| l.strip_prefix("host: ")).unwrap_or("").trim().to_string();
            let url = Url::parse(&format!("http://{host}{target}")).unwrap();
            let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned()).unwrap_or_default();
            match url.path() {
                "/.pomerium/api/v1/login" => http("200 OK", "Content-Type: text/plain\r\n", &format!("http://{host}/signin?r={}", param("pomerium_redirect_uri"))),
                "/signin" => http("302 Found", &format!("Location: {}?pomerium_jwt=tok123\r\n", param("r")), ""),
                _ => html_page("<title>Pomerium</title>"),
            }
        });
        let front = {
            let pomerium = pomerium.clone();
            spawn_server(move |target, headers| {
                if target.starts_with("/users/current.json") && headers.contains("authorization: pomerium tok123") {
                    http("200 OK", "Content-Type: application/json\r\n", r#"{"user":{"id":5,"login":"alex","firstname":"Alex","lastname":"Rivera"}}"#)
                } else if target.starts_with("/users/current.json") {
                    http("302 Found", &format!("Location: {pomerium}/?uri=http://redmine{target}\r\n"), "")
                } else {
                    http("404 Not Found", "Content-Type: text/html\r\n", "<title>Redmine 404 error</title>")
                }
            })
        };

        let err = Redmine::new(&front, "k", None).unwrap().current_user().await.unwrap_err();
        assert!(matches!(err, Error::Sso), "{err}");

        let (_keep, rx) = tokio::sync::oneshot::channel();
        let token = crate::sso::pomerium_login(&front, follow_in_background, rx).await.unwrap();
        assert_eq!(token, "tok123");

        let me = Redmine::new(&front, "k", Some(token)).unwrap().current_user().await.unwrap();
        assert_eq!(me.name, "Alex Rivera");
    }

    #[tokio::test]
    async fn pomerium_sign_in_can_be_cancelled_and_rejects_other_servers() {
        let base = fake_pomerium();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tx.send(()).unwrap();
        let err = crate::sso::pomerium_login(&base, |_| Ok(()), rx).await.unwrap_err().to_string();
        assert!(err.contains("cancelled"), "{err}");

        let plain = spawn_server(|_, _| http("404 Not Found", "", "nope"));
        let (_keep, rx) = tokio::sync::oneshot::channel();
        let err = crate::sso::pomerium_login(&plain, |_| Ok(()), rx).await.unwrap_err().to_string();
        assert!(err.contains("No Pomerium sign-in found") && err.contains("answered 404"), "{err}");
    }

    #[test]
    fn errors_serialize_with_a_kind() {
        assert_eq!(serde_json::to_value(Error::Sso).unwrap()["kind"], "sso");
        let v = serde_json::to_value(Error::from("boom")).unwrap();
        assert_eq!((v["kind"].as_str(), v["message"].as_str()), (Some("error"), Some("boom")));
    }

    #[test]
    fn snaps_hours_to_quarters() {
        assert_eq!(check_hours(1.1).unwrap(), 1.0);
        assert_eq!(check_hours(1.13).unwrap(), 1.25);
        assert_eq!(check_hours(0.25).unwrap(), 0.25);
        assert!(check_hours(0.0).is_err());
        assert!(check_hours(0.1).is_err());
        assert!(check_hours(24.5).is_err());
    }

    /// Full round trip against a real Redmine. Needs a disposable instance with
    /// the REST API on and at least one open issue assigned to the key's user:
    ///
    /// REDMINE_URL=http://localhost:3300 REDMINE_KEY=… cargo test live -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_roundtrip() {
        let url = normalize_url(&std::env::var("REDMINE_URL").expect("REDMINE_URL")).unwrap();
        let key = std::env::var("REDMINE_KEY").expect("REDMINE_KEY");
        let day = "2026-11-02";

        let bad = Redmine::new(&url, "not-a-key", None).unwrap();
        let err = bad.current_user().await.unwrap_err().to_string();
        assert!(err.contains("rejected the API key"), "{err}");

        let rm = Redmine::new(&url, &key, None).unwrap();
        let me = rm.current_user().await.unwrap();
        println!("user: {me:?}");

        let suggested = rm.search_issues("").await.unwrap();
        assert!(!suggested.is_empty(), "no assigned issues to suggest");
        let issue = suggested[0].clone();
        println!("issue: {issue:?}");

        let by_id = rm.search_issues(&format!("#{}", issue.id)).await.unwrap();
        assert_eq!(by_id[0].id, issue.id, "exact id match should come first");
        let word = issue.subject.split_whitespace().next().unwrap();
        let by_text = rm.search_issues(word).await.unwrap();
        assert!(by_text.iter().any(|h| h.id == issue.id), "subject search for {word:?}");

        let acts = rm.activities(issue.project_id).await;
        println!("activities: {acts:?}");
        // Stock Redmine has no default activity; create_entry then falls back to the first one.
        assert!(!acts.is_empty(), "expected activities for the project");

        let created = rm
            .create_entry(NewEntry {
                issue_id: issue.id,
                project_id: issue.project_id,
                spent_on: day.into(),
                hours: 1.1,
                comments: "live test".into(),
                activity_id: None,
            })
            .await
            .unwrap();
        assert_eq!(created.hours, 1.0, "1.1h should snap to 1.0");
        assert_eq!(created.issue_subject.as_deref(), Some(issue.subject.as_str()));

        let listed = rm.time_entries(me.id, day, day).await.unwrap();
        assert!(listed.iter().any(|e| e.id == created.id && e.issue_subject.is_some()));

        let updated = rm.update_entry(created.id, Some(2.6), Some("edited".into()), None).await.unwrap();
        assert_eq!(updated.hours, 2.5);
        assert_eq!(updated.comments, "edited");

        assert!(rm.create_entry(NewEntry { issue_id: issue.id, project_id: None, spent_on: day.into(), hours: 0.0, comments: String::new(), activity_id: None }).await.is_err());

        rm.delete_entry(created.id).await.unwrap();
        let after = rm.time_entries(me.id, day, day).await.unwrap();
        assert!(after.iter().all(|e| e.id != created.id));
    }

    #[test]
    fn parses_time_entry_without_issue() {
        let v = json!({"id": 7, "project": {"id": 1, "name": "P"}, "activity": {"id": 9, "name": "Dev"},
                       "hours": 1.5, "comments": null, "spent_on": "2026-11-02"});
        let e = parse_entry(&v).unwrap();
        assert_eq!(e.issue_id, None);
        assert_eq!(e.comments, "");
        assert_eq!(e.hours, 1.5);
    }
}
