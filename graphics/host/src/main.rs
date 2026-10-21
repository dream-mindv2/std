//! Optional desktop host. The VM and compiler never depend on this crate.
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{mpsc, Arc},
    thread,
};
use serde_json::{json, Value};
use tao::{event::{Event, WindowEvent}, event_loop::{ControlFlow, EventLoopBuilder}, window::WindowBuilder};
use wry::{http::{Request, Response}, WebViewBuilder};

const MAX_MESSAGE: usize = 1024 * 1024;
const CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

#[derive(Debug)]
enum HostEvent { Reply(Value), Failed(String), Close }

fn trusted(uri: &wry::http::Uri) -> bool {
    matches!((uri.scheme_str(), uri.authority().map(|a| a.as_str())),
        (Some("dream"), Some("localhost")) | (Some("http"), Some("dream.localhost")))
}

fn asset_response(request: Request<Vec<u8>>, assets: &BTreeMap<String, Vec<u8>>) -> Response<Vec<u8>> {
    let path = request.uri().path();
    let mime = match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("mjs") => "text/javascript; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    };
    let found = trusted(request.uri()) && request.method() == "GET";
    let bytes = if found { assets.get(path) } else { None };
    Response::builder().status(if bytes.is_some() { 200 } else { 404 })
        .header("Content-Type", mime).header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store")
        .body(bytes.cloned().unwrap_or_default()).expect("fixed headers are valid")
}

fn main() {
    if let Err(error) = run() { eprintln!("dream graphics: {error}"); std::process::exit(1); }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // No shell and no PATH lookup for app-controlled commands. All paths are
    // launcher configuration, outside the frontend command protocol.
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 3 { return Err("usage: dream-graphics-host ASSETS DREAM_VM BACKEND_IMAGE".into()); }
    #[cfg(target_os = "linux")]
    if std::env::var_os("DISPLAY").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return Err("graphics_unavailable: no display".into());
    }
    let dir = PathBuf::from(&args[0]).canonicalize()?;
    let vm = PathBuf::from(&args[1]).canonicalize()?;
    let backend = PathBuf::from(&args[2]).canonicalize()?;
    let mut assets = BTreeMap::new();
    for name in ["index.html", "main.mjs", "dom.mjs", "worker.mjs", "dream-browser.mjs", "dream-browser.wasm", "frontend.dream"] {
        let file = std::fs::File::open(dir.join(name))?;
        let mut bytes = Vec::new();
        file.take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > 64 * 1024 * 1024 { return Err("asset exceeds size limit".into()); }
        assets.insert(format!("/{name}"), bytes);
    }
    let assets = Arc::new(assets);
    let event_loop = EventLoopBuilder::<HostEvent>::with_user_event().build();
    let window = WindowBuilder::new().with_title("Dream").build(&event_loop)?;
    let proxy = event_loop.create_proxy();
    let (sender, receiver) = mpsc::sync_channel::<String>(64);
    let mut child = Command::new(vm).arg(backend).stdin(Stdio::piped()).stdout(Stdio::piped())
        .stderr(Stdio::inherit()).spawn()?;
    let mut input = child.stdin.take().ok_or("missing child stdin")?;
    let output = child.stdout.take().ok_or("missing child stdout")?;
    let writer_proxy = proxy.clone();
    thread::spawn(move || {
        for message in receiver {
            if writeln!(input, "{message}").and_then(|_| input.flush()).is_err() {
                let _ = writer_proxy.send_event(HostEvent::Failed("backend pipe closed".into()));
                break;
            }
        }
    });
    let reader_proxy = proxy.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            let mut bytes = Vec::new();
            let read = (&mut reader).take((MAX_MESSAGE + 2) as u64).read_until(b'\n', &mut bytes);
            if !matches!(read, Ok(n) if n > 0 && n <= MAX_MESSAGE + 1) || bytes.last() != Some(&b'\n') {
                let _ = reader_proxy.send_event(HostEvent::Failed("backend stopped or sent an invalid frame".into()));
                break;
            }
            match serde_json::from_slice::<Value>(&bytes) {
                Ok(value) if value.get("name").is_some_and(Value::is_string) => {
                    if reader_proxy.send_event(HostEvent::Reply(value)).is_err() { break; }
                }
                _ => { let _ = reader_proxy.send_event(HostEvent::Failed("invalid backend response".into())); break; }
            }
        }
    });
    let builder = WebViewBuilder::new()
        .with_custom_protocol("dream".into(), move |_, request| asset_response(request, &assets).map(Into::into))
        .with_navigation_handler(|url| url == "dream://localhost/index.html" || url == "http://dream.localhost/index.html")
        .with_ipc_handler(move |request| {
            if !trusted(request.uri()) || request.body().len() > MAX_MESSAGE { return; }
            let Ok(value) = serde_json::from_str::<Value>(request.body()) else { return; };
            if value["type"] == "close" { let _ = proxy.send_event(HostEvent::Close); return; }
            if value["type"] != "invoke" { return; }
            let Some(reply) = value["reply"].as_str().filter(|v| !v.is_empty() && v.len() <= 256) else { return; };
            if !value["command"].as_str().is_some_and(|v| !v.is_empty() && v.len() <= 256) { return; }
            if !value["payload"].as_str().is_some_and(|v| serde_json::from_str::<Value>(v).is_ok()) { return; }
            if sender.try_send(value.to_string()).is_err() {
                let _ = proxy.send_event(HostEvent::Reply(json!({"name":reply,"key":"","value":{"ok":false,"error":"backend_busy"}})));
            }
        })
        .with_url("dream://localhost/index.html");
    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.gtk_window())
    };
    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window);
    let webview = match webview {
        Ok(view) => view,
        Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error.into()); }
    };
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(HostEvent::Reply(value)) => {
                // JSON serialization escapes every character that could end
                // the argument. There is no interpolation of raw user text.
                let script = format!("window.__dreamReceive({value});");
                if let Err(error) = webview.evaluate_script(&script) { eprintln!("graphics reply: {error}"); }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } | Event::UserEvent(HostEvent::Close) => {
                let _ = child.kill(); let _ = child.wait();
                *flow = ControlFlow::Exit;
            }
            Event::UserEvent(HostEvent::Failed(message)) => {
                eprintln!("dream graphics: {message}");
                let _ = child.kill(); let _ = child.wait();
                *flow = ControlFlow::ExitWithCode(1);
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_local_origins_are_trusted() {
        for url in ["dream://localhost/index.html", "http://dream.localhost/index.html"] {
            assert!(trusted(&url.parse().unwrap()));
        }
        for url in ["https://example.com", "dream://localhost.evil/index.html", "http://dream.localhost:80/index.html"] {
            assert!(!trusted(&url.parse().unwrap()));
        }
    }
    #[test]
    fn assets_are_exact_allowlisted_paths() {
        let assets = BTreeMap::from([("/index.html".into(), b"hello".to_vec())]);
        for path in ["/../backend.dream", "/%2e%2e/backend.dream", "/frontend.dream"] {
            let request = Request::builder().uri(format!("dream://localhost{path}")).body(vec![]).unwrap();
            assert_eq!(asset_response(request, &assets).status(), 404);
        }
    }
}
