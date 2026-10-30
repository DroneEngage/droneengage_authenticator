//! HTTP/1.1 connections the way Node's http server answers them: header
//! names and order exactly as the app set them, then `Date`, `Connection`
//! and `Keep-Alive: timeout=5` (or `Transfer-Encoding: chunked` for a
//! streamed reply), keep-alive and pipelining, `100 Continue`, and a bare
//! `400 Bad Request` for an unparsable request. An upgrade request goes to
//! the server's upgrade handler when it has one (Node emits 'upgrade'),
//! else it is an ordinary request.

use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::http::{Request, Response};
use super::Reply;
use droneengage_server_common::ws_accept::RequestHead;

const MAX_HEADER_BYTES: usize = 16 * 1024;
/// A larger request body than this is not read (the connection closes).
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const KEEP_ALIVE: Duration = Duration::from_secs(5);

/// A connection with its read-ahead buffer.
pub struct Conn<S> {
    pub stream: S,
    pub buf: Vec<u8>,
}

/// One parsed request head.
pub struct Head {
    pub head: RequestHead,
    pub version_minor: u8,
}

impl Head {
    fn header(&self, p_name: &str) -> Option<String> {
        self.head.header(p_name)
    }

    /// Node's req.upgrade: an Upgrade header with `Connection: upgrade`.
    pub fn is_upgrade(&self) -> bool {
        self.header("upgrade").is_some()
            && self
                .header("connection")
                .map(|c| c.split(',').any(|t| t.trim().eq_ignore_ascii_case("upgrade")))
                .unwrap_or(false)
    }

    fn keep_alive(&self) -> bool {
        let v_conn = self.header("connection").unwrap_or_default().to_ascii_lowercase();
        if v_conn.split(',').any(|t| t.trim() == "close") {
            return false;
        }
        self.version_minor >= 1 || v_conn.split(',').any(|t| t.trim() == "keep-alive")
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin> Conn<S> {
    pub fn new(p_stream: S) -> Conn<S> {
        Conn { stream: p_stream, buf: Vec::new() }
    }

    async fn fill(&mut self) -> std::io::Result<usize> {
        let mut v_chunk = [0u8; 8192];
        let n = self.stream.read(&mut v_chunk).await?;
        self.buf.extend_from_slice(&v_chunk[..n]);
        Ok(n)
    }

    /// The next request head: Ok(None) at end of stream, Err(code) for a
    /// request Node rejects.
    pub async fn read_head(&mut self, p_idle: Option<Duration>) -> Result<Option<Head>, u16> {
        loop {
            if !self.buf.is_empty() {
                // leading CRLFs between requests are ignored
                while self.buf.starts_with(b"\r\n") {
                    self.buf.drain(..2);
                }
                let mut v_headers = [httparse::EMPTY_HEADER; 128];
                let mut v_req = httparse::Request::new(&mut v_headers);
                match v_req.parse(&self.buf) {
                    Ok(httparse::Status::Complete(v_len)) => {
                        let v_head = Head {
                            head: RequestHead {
                                method: v_req.method.unwrap_or("").to_string(),
                                url: v_req.path.unwrap_or("/").to_string(),
                                headers: v_req
                                    .headers
                                    .iter()
                                    .map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).into_owned()))
                                    .collect(),
                            },
                            version_minor: v_req.version.unwrap_or(1),
                        };
                        self.buf.drain(..v_len);
                        return Ok(Some(v_head));
                    }
                    Ok(httparse::Status::Partial) => {
                        if self.buf.len() > MAX_HEADER_BYTES {
                            return Err(431);
                        }
                    }
                    Err(httparse::Error::TooManyHeaders) => return Err(431),
                    Err(_) => return Err(400),
                }
            }
            let v_read = match p_idle {
                Some(d) if self.buf.is_empty() => match tokio::time::timeout(d, self.fill()).await {
                    Ok(r) => r,
                    Err(_) => return Ok(None),
                },
                _ => self.fill().await,
            };
            match v_read {
                Ok(0) | Err(_) => return if self.buf.is_empty() { Ok(None) } else { Err(400) },
                Ok(_) => {}
            }
        }
    }

    async fn read_exact_body(&mut self, p_len: usize) -> Option<Vec<u8>> {
        while self.buf.len() < p_len {
            if self.fill().await.ok()? == 0 {
                return None;
            }
        }
        Some(self.buf.drain(..p_len).collect())
    }

    async fn read_line(&mut self) -> Option<String> {
        loop {
            if let Some(i) = self.buf.windows(2).position(|w| w == b"\r\n") {
                let v_line = String::from_utf8_lossy(&self.buf[..i]).into_owned();
                self.buf.drain(..i + 2);
                return Some(v_line);
            }
            if self.buf.len() > MAX_HEADER_BYTES || self.fill().await.ok()? == 0 {
                return None;
            }
        }
    }

    /// The request body (Content-Length or chunked).
    async fn read_body(&mut self, p_head: &Head) -> Option<Vec<u8>> {
        let v_chunked = p_head
            .header("transfer-encoding")
            .map(|t| t.to_ascii_lowercase().split(',').any(|p| p.trim() == "chunked"))
            .unwrap_or(false);
        if v_chunked {
            let mut v_out = Vec::new();
            loop {
                let v_line = self.read_line().await?;
                let v_size = usize::from_str_radix(v_line.split(';').next()?.trim(), 16).ok()?;
                if v_size == 0 {
                    // trailers
                    loop {
                        if self.read_line().await?.is_empty() {
                            return Some(v_out);
                        }
                    }
                }
                if v_out.len() + v_size > MAX_BODY_BYTES {
                    return None;
                }
                v_out.extend(self.read_exact_body(v_size).await?);
                self.read_exact_body(2).await?;
            }
        }
        match p_head.header("content-length") {
            Some(l) => {
                let v_len: usize = l.trim().parse().ok()?;
                if v_len > MAX_BODY_BYTES {
                    return None;
                }
                self.read_exact_body(v_len).await
            }
            None => Some(Vec::new()),
        }
    }

    /// Waits until the peer closes (a request that is never answered).
    pub async fn wait_closed(&mut self) {
        let mut v_chunk = [0u8; 4096];
        while let Ok(n) = self.stream.read(&mut v_chunk).await {
            if n == 0 {
                break;
            }
        }
    }
}

/// http.STATUS_CODES
pub fn reason(p_code: u16) -> &'static str {
    match p_code {
        100 => "Continue",
        101 => "Switching Protocols",
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

/// The response bytes (status line, headers, Node's trailing headers, body).
pub fn serialize(p_res: &Response, p_head_only: bool, p_chunked: bool, p_keep_alive: bool) -> Vec<u8> {
    let mut v = format!("HTTP/1.1 {} {}\r\n", p_res.status, reason(p_res.status));
    for (k, val) in &p_res.headers {
        v.push_str(&format!("{}: {}\r\n", k, val));
    }
    if !p_res.headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("date")) {
        v.push_str(&format!("Date: {}\r\n", super::http::http_date(droneengage_server_common::util::now_ms())));
    }
    if p_keep_alive {
        v.push_str("Connection: keep-alive\r\nKeep-Alive: timeout=5\r\n");
    } else {
        v.push_str("Connection: close\r\n");
    }
    let v_body_allowed = !p_head_only && p_res.status != 204 && p_res.status != 304;
    if p_chunked {
        v.push_str("Transfer-Encoding: chunked\r\n");
    }
    v.push_str("\r\n");
    let mut v_bytes = v.into_bytes();
    if p_chunked {
        if v_body_allowed && !p_res.body.is_empty() {
            v_bytes.extend(format!("{:x}\r\n", p_res.body.len()).into_bytes());
            v_bytes.extend(&p_res.body);
            v_bytes.extend(b"\r\n");
        }
        v_bytes.extend(b"0\r\n\r\n");
    } else if v_body_allowed {
        v_bytes.extend(&p_res.body);
    }
    v_bytes
}

/// What the connection loop does with an upgrade request.
pub enum Upgrade<S> {
    /// handled (the connection is consumed)
    Taken,
    /// not handled: an ordinary request
    Ordinary(Conn<S>, Head),
}

/// The keep-alive loop: each request goes to p_handler; p_upgrade (when the
/// server has an 'upgrade' listener) takes upgrade requests.
pub async fn serve<S, H, HF, U, UF>(
    p_stream: S,
    p_remote: SocketAddr,
    p_secure: bool,
    p_handler: H,
    p_upgrade: Option<U>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    H: Fn(Request) -> HF,
    HF: std::future::Future<Output = Reply>,
    U: Fn(Conn<S>, Head) -> UF,
    UF: std::future::Future<Output = Upgrade<S>>,
{
    let mut v_conn = Conn::new(p_stream);
    let mut v_first = true;
    loop {
        let v_head = match v_conn.read_head(if v_first { None } else { Some(KEEP_ALIVE) }).await {
            Ok(Some(h)) => h,
            Ok(None) => return,
            Err(code) => {
                let v_msg = if code == 431 {
                    "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n"
                } else {
                    "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"
                };
                let _ = v_conn.stream.write_all(v_msg.as_bytes()).await;
                let _ = v_conn.stream.shutdown().await;
                return;
            }
        };
        v_first = false;
        let mut v_head = v_head;
        if v_head.is_upgrade() {
            if let Some(u) = &p_upgrade {
                match u(v_conn, v_head).await {
                    Upgrade::Taken => return,
                    Upgrade::Ordinary(c, h) => {
                        v_conn = c;
                        v_head = h;
                    }
                }
            }
        }
        if v_head.header("expect").map(|e| e.trim().eq_ignore_ascii_case("100-continue")).unwrap_or(false)
            && v_conn.stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await.is_err()
        {
            return;
        }
        let Some(v_body) = v_conn.read_body(&v_head).await else {
            let _ = v_conn.stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n").await;
            return;
        };
        let v_keep = v_head.keep_alive();
        let v_url = v_head.head.url.clone();
        let (v_path, v_query) = v_url.split_once('?').unwrap_or((v_url.as_str(), ""));
        let v_method = v_head.head.method.clone();
        let v_req = Request {
            method: v_method.clone(),
            path: v_path.to_string(),
            query_raw: v_query.to_string(),
            headers: v_head.head.headers,
            body: v_body,
            ip: p_remote.ip().to_string(),
            secure: p_secure,
        };
        let v_bytes = match p_handler(v_req).await {
            Reply::Full(r) => serialize(&r, v_method == "HEAD", false, v_keep),
            Reply::Chunked(r) => serialize(&r, v_method == "HEAD", true, v_keep),
            Reply::Hang => {
                v_conn.wait_closed().await;
                return;
            }
        };
        if v_conn.stream.write_all(&v_bytes).await.is_err() {
            return;
        }
        let _ = v_conn.stream.flush().await;
        if !v_keep {
            let _ = v_conn.stream.shutdown().await;
            return;
        }
    }
}

/// A stream that replays already-read bytes before reading the socket
/// (the WebSocket after its handshake).
pub struct Prefixed<S> {
    m_prefix: Vec<u8>,
    m_inner: S,
}

impl<S> Prefixed<S> {
    pub fn new(p_prefix: Vec<u8>, p_inner: S) -> Prefixed<S> {
        Prefixed { m_prefix: p_prefix, m_inner: p_inner }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Prefixed<S> {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        p_cx: &mut std::task::Context<'_>,
        p_buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        if !self.m_prefix.is_empty() {
            let n = self.m_prefix.len().min(p_buf.remaining());
            let v: Vec<u8> = self.m_prefix.drain(..n).collect();
            p_buf.put_slice(&v);
            return std::task::Poll::Ready(Ok(()));
        }
        std::pin::Pin::new(&mut self.m_inner).poll_read(p_cx, p_buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Prefixed<S> {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        p_cx: &mut std::task::Context<'_>,
        p_buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.m_inner).poll_write(p_cx, p_buf)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        p_cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.m_inner).poll_flush(p_cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        p_cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.m_inner).poll_shutdown(p_cx)
    }
}

/// A boxed client stream (TLS or plain TCP).
pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}
pub type BoxIo = Box<dyn Io>;

/// ws 8's abortHandshake response.
fn ws_abort(p_code: u16, p_message: &str, p_extra: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Type: text/html\r\nContent-Length: {}{}\r\n\r\n{}",
        p_code,
        reason(p_code),
        p_message.len(),
        p_extra,
        p_message
    )
    .into_bytes()
}

/// ws 8's handleUpgrade validation: the 101 response, or the error
/// response it writes before closing.
pub fn ws_handshake(p_head: &RequestHead) -> Result<Vec<u8>, Vec<u8>> {
    if p_head.method != "GET" {
        return Err(ws_abort(405, "Invalid HTTP method", ""));
    }
    if p_head.header("upgrade").map(|u| u.to_lowercase() != "websocket").unwrap_or(true) {
        return Err(ws_abort(400, "Invalid Upgrade header", ""));
    }
    let v_key = p_head.header("sec-websocket-key").unwrap_or_default();
    let v_key_ok = v_key.len() == 24
        && v_key.ends_with("==")
        && v_key[..22].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/');
    if !v_key_ok {
        return Err(ws_abort(400, "Missing or invalid Sec-WebSocket-Key header", ""));
    }
    let v_version = p_head.header("sec-websocket-version").map(|v| v.trim().parse::<f64>().ok()).unwrap_or(None);
    if v_version != Some(13.0) && v_version != Some(8.0) {
        return Err(ws_abort(
            400,
            "Missing or invalid Sec-WebSocket-Version header",
            "\r\nSec-WebSocket-Version: 13, 8",
        ));
    }
    let mut v_protocol = None;
    if let Some(v_list) = p_head.header("sec-websocket-protocol") {
        // subprotocol.parse: comma separated tokens, no duplicates
        let mut v_seen: Vec<String> = Vec::new();
        for t in v_list.split(',') {
            let t = t.trim_matches([' ', '\t']);
            let v_token_ok =
                !t.is_empty() && t.bytes().all(|b| b.is_ascii_graphic() && !b"()<>@,;:\\\"/[]?={}".contains(&b));
            if !v_token_ok || v_seen.iter().any(|s| s == t) {
                return Err(ws_abort(400, "Invalid Sec-WebSocket-Protocol header", ""));
            }
            v_seen.push(t.to_string());
        }
        v_protocol = v_seen.into_iter().next();
    }
    let mut v_resp = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n",
        tokio_tungstenite::tungstenite::handshake::derive_accept_key(v_key.as_bytes())
    );
    if let Some(p) = v_protocol {
        v_resp.push_str(&format!("Sec-WebSocket-Protocol: {}\r\n", p));
    }
    v_resp.push_str("\r\n");
    Ok(v_resp.into_bytes())
}
