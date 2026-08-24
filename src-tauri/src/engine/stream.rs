use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

use anyhow::Result;
use axum::extract::{Path as AxPath, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use futures::Stream;
use librqbit::{ManagedTorrent, Session};
use tokio::io::AsyncRead;

const CHUNK_SIZE: usize = 256 * 1024;

#[derive(Clone)]
pub struct StreamServer {
    pub session: Arc<Session>,
    pub active: Arc<AtomicUsize>,
}

struct ActiveGuard {
    counter: Arc<AtomicUsize>,
}

impl ActiveGuard {
    fn new(counter: Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        ActiveGuard { counter }
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::Relaxed);
    }
}

fn content_type(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mkv" => "video/x-matroska",
        "mp4" | "m4v" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "ts" | "mts" | "m2ts" => "video/mp2t",
        "srt" => "application/x-subrip",
        _ => "application/octet-stream",
    }
}

fn is_video(name: &str) -> bool {
    matches!(
        name.rsplit('.')
            .next()
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("mkv" | "mp4" | "m4v" | "avi" | "mov" | "webm" | "ts" | "mts" | "m2ts")
    )
}

/// Parse a single-range Range header into an absolute (start, end) pair,
/// end inclusive. Returns None when absent, Err on malformed/unsatisfiable.
fn parse_range(header: &str, len: u64) -> std::result::Result<Option<(u64, u64)>, ()> {
    const PREFIX: &str = "bytes=";
    if len == 0 {
        return Err(());
    }
    let Some(spec) = header.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    if spec.contains(',') {
        // multiple ranges unsupported: serve only the first one
        let spec = spec.split(',').next().unwrap_or("");
        return parse_range_inner(spec.trim(), len);
    }
    parse_range_inner(spec.trim(), len)
}

fn parse_range_inner(spec: &str, len: u64) -> std::result::Result<Option<(u64, u64)>, ()> {
    if let Some(suffix) = spec.strip_prefix('-') {
        let n: u64 = suffix.parse().map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        let start = len.saturating_sub(n);
        return Ok(Some((start, len - 1)));
    }
    let (start_s, end_s) = spec.split_once('-').ok_or(())?;
    let start: u64 = start_s.parse().map_err(|_| ())?;
    let end: u64 = if end_s.is_empty() {
        len - 1
    } else {
        end_s.parse().map_err(|_| ())?
    };
    if start >= len || end < start {
        return Err(());
    }
    Ok(Some((start, end.min(len - 1))))
}

struct BodyStream {
    file: Box<dyn AsyncRead + Unpin + Send>,
    remaining: u64,
    _guard: ActiveGuard,
}

impl Stream for BodyStream {
    type Item = std::io::Result<Bytes>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        if this.remaining == 0 {
            return Poll::Ready(None);
        }
        let want = this.remaining.min(CHUNK_SIZE as u64) as usize;
        let mut buf = vec![0u8; want];
        let mut read_buf = tokio::io::ReadBuf::new(&mut buf);
        match Pin::new(&mut this.file).poll_read(cx, &mut read_buf) {
            Poll::Ready(Ok(())) => {}
            Poll::Ready(Err(e)) => return Poll::Ready(Some(Err(e))),
            Poll::Pending => return Poll::Pending,
        }
        let n = read_buf.filled().len();
        if n == 0 {
            return Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "stream ended before expected length",
            ))));
        }
        let out = Bytes::copy_from_slice(read_buf.filled());
        this.remaining -= n as u64;
        Poll::Ready(Some(Ok(out)))
    }
}

async fn stream_handler(
    State(state): State<StreamServer>,
    AxPath((id, file_id)): AxPath<(usize, usize)>,
    headers: HeaderMap,
) -> Response {
    let handle = state.session.get(id.into()).ok_or(StatusCode::NOT_FOUND);
    let handle: Arc<ManagedTorrent> = match handle {
        Ok(h) => h,
        Err(s) => return (s, "torrent not found").into_response(),
    };

    let name = handle
        .with_metadata(|m| {
            m.file_infos
                .get(file_id)
                .map(|fi| fi.relative_filename.to_string_lossy().into_owned())
        })
        .ok()
        .flatten();
    let Some(name) = name else {
        return (StatusCode::NOT_FOUND, "file not found").into_response();
    };
    let file_len = handle
        .with_metadata(|m| m.file_infos[file_id].len)
        .unwrap_or(0);

    let mut file_stream = match handle.clone().stream(file_id).await {
        Ok(fs) => fs,
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("stream not ready: {e}"),
            )
                .into_response()
        }
    };

    let (status, start, end) = match headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|v| parse_range(v, file_len))
        .unwrap_or(Ok(None))
    {
        Ok(Some((s, e))) => (StatusCode::PARTIAL_CONTENT, s, e),
        Ok(None) => (StatusCode::OK, 0, file_len.saturating_sub(1)),
        Err(()) => {
            let mut resp = (
                StatusCode::RANGE_NOT_SATISFIABLE,
                format!("bytes */{file_len}"),
            )
                .into_response();
            resp.headers_mut().insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes */{file_len}")).unwrap(),
            );
            return resp;
        }
    };

    use tokio::io::AsyncSeekExt;
    if let Err(e) = AsyncSeekExt::seek(&mut file_stream, std::io::SeekFrom::Start(start)).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("seek failed: {e}"),
        )
            .into_response();
    }

    let length = end - start + 1;
    let body = BodyStream {
        file: Box::new(file_stream),
        remaining: length,
        _guard: ActiveGuard::new(state.active.clone()),
    };

    let filename = name.rsplit(['\\', '/']).next().unwrap_or(&name).to_string();
    let mut headers_out = HeaderMap::new();
    headers_out.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers_out.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type(&filename)),
    );
    headers_out.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&length.to_string()).unwrap(),
    );
    headers_out.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if status == StatusCode::PARTIAL_CONTENT {
        headers_out.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{file_len}")).unwrap(),
        );
    } else {
        headers_out.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!(
                "inline; filename*=UTF-8''{}",
                utf8_percent_encode(&filename)
            ))
            .unwrap_or(HeaderValue::from_static("inline")),
        );
    }

    (status, headers_out, axum::body::Body::from_stream(body)).into_response()
}

fn utf8_percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Metadata endpoint used by the UI to know how many bytes of the lookahead
/// window around `position` are already on disk.
pub fn is_video_file(name: &str) -> bool {
    is_video(name)
}

pub async fn spawn_server(session: Arc<Session>) -> Result<u16> {
    let state = StreamServer {
        session,
        active: Arc::new(AtomicUsize::new(0)),
    };
    let app = Router::new()
        .route("/stream/{id}/{file}", get(stream_handler))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("stream server stopped: {e}");
        }
    });
    Ok(port)
}
