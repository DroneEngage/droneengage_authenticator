//! The admin wiki (wiki/*.md rendered to HTML). Links to other pages
//! (`Foo.md`) become /admin[/<guid>]/wiki/Foo, links into other
//! repositories (`../x/Foo.md`) become plain text marked "(external)", and
//! `images/x.png` is served from wiki/images.
//!
//! Differences from the Node.js server: Markdown is parsed by
//! pulldown-cmark (CommonMark + GFM tables, strikethrough, task lists)
//! and written in marked's HTML format, so only constructs the two parsers
//! read differently can differ; a page name is resolved strictly inside
//! wiki/ (the JavaScript prefix check also accepted sibling directories
//! whose names start with "wiki").

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, TagEnd};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

use super::http::{Request, Response};

fn wiki_dir(p_root: &Path) -> PathBuf {
    p_root.join("wiki")
}

/// `/^#\s+(.+)$/m`: the first H1 line's text.
fn first_h1(p_text: &str) -> Option<String> {
    let v = regex::Regex::new(r"(?m)^#\s+(.+)$").ok()?;
    v.captures(p_text).map(|c| c[1].trim().to_string())
}

/// getWikiPages: `{name, title}` sorted by title.
pub fn pages(p_root: &Path) -> Vec<Value> {
    let Ok(v_dir) = std::fs::read_dir(wiki_dir(p_root)) else { return vec![] };
    let mut v_names: Vec<String> =
        v_dir.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|f| f.ends_with(".md")).collect();
    v_names.sort();
    let mut v_out = Vec::new();
    for f in v_names {
        let v_base = f.trim_end_matches(".md").to_string();
        let Ok(v_text) = std::fs::read_to_string(wiki_dir(p_root).join(&f)) else { return vec![] };
        let v_title = first_h1(&v_text).unwrap_or_else(|| v_base.clone());
        v_out.push(json!({ "name": v_base, "title": v_title }));
    }
    v_out.sort_by(|a, b| {
        crate::jsv::locale_compare(a["title"].as_str().unwrap_or(""), b["title"].as_str().unwrap_or(""))
    });
    v_out
}

/// path.join + normalize, refusing anything outside p_base.
fn inside(p_base: &Path, p_rel: &str) -> Option<PathBuf> {
    let mut v_out = p_base.to_path_buf();
    for c in Path::new(p_rel).components() {
        match c {
            Component::Normal(n) => v_out.push(n),
            Component::CurDir => {}
            Component::ParentDir => {
                if !v_out.pop() {
                    return None;
                }
            }
            _ => return None,
        }
    }
    v_out.starts_with(p_base).then_some(v_out)
}

fn rewrite_image(p_href: &str, p_prefix: &str) -> String {
    match p_href.strip_prefix("images/") {
        Some(r) => format!("/admin{}/wiki/images/{}", p_prefix, r),
        None => p_href.to_string(),
    }
}

/// renderWikiPage: the page's HTML, or None (missing / outside wiki/).
pub fn render(p_root: &Path, p_page: &str, p_guid: Option<&str>) -> Option<String> {
    let v_path = inside(&wiki_dir(p_root), &format!("{}.md", p_page))?;
    let v_text = std::fs::read_to_string(v_path).ok()?;
    let v_prefix = p_guid.map(|g| format!("/{}", g)).unwrap_or_default();
    let mut v_opts = Options::empty();
    v_opts.insert(Options::ENABLE_TABLES);
    v_opts.insert(Options::ENABLE_STRIKETHROUGH);
    v_opts.insert(Options::ENABLE_TASKLISTS);
    let mut v_events: Vec<Event<'_>> = Vec::new();
    let mut v_external_depth: Vec<bool> = Vec::new();
    for ev in Parser::new_ext(&v_text, v_opts) {
        match ev {
            Event::Start(Tag::Link { link_type, dest_url, title, id }) => {
                let v_href = dest_url.to_string();
                let v_local = !v_href.starts_with("http") && !v_href.starts_with('#') && !v_href.starts_with("mailto:");
                if v_local && v_href.ends_with(".md") && v_href.contains("../") {
                    v_external_depth.push(true);
                    continue;
                }
                v_external_depth.push(false);
                let mut v_new = v_href.clone();
                if v_local {
                    if v_new.ends_with(".md") {
                        let v_base =
                            Path::new(&v_new).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                        v_new = format!("/admin{}/wiki/{}", v_prefix, v_base);
                    }
                    v_new = rewrite_image(&v_new, &v_prefix);
                }
                v_events.push(Event::Start(Tag::Link { link_type, dest_url: CowStr::from(v_new), title, id }));
            }
            Event::End(TagEnd::Link) => {
                if v_external_depth.pop() == Some(true) {
                    v_events.push(Event::InlineHtml(CowStr::from(" <small class=\"text-muted\">(external)</small>")));
                } else {
                    v_events.push(Event::End(TagEnd::Link));
                }
            }
            Event::Start(Tag::Image { link_type, dest_url, title, id }) => {
                let v_href = dest_url.to_string();
                let v_new = if !v_href.starts_with("http") && !v_href.starts_with("data:") {
                    rewrite_image(&v_href, &v_prefix)
                } else {
                    v_href
                };
                v_events.push(Event::Start(Tag::Image { link_type, dest_url: CowStr::from(v_new), title, id }));
            }
            other => v_events.push(other),
        }
    }
    Some(marked_html(v_events))
}

/// marked's escape(): & < > " '
fn escape(p_text: &str) -> String {
    let mut v = String::with_capacity(p_text.len());
    for c in p_text.chars() {
        match c {
            '&' => v.push_str("&amp;"),
            '<' => v.push_str("&lt;"),
            '>' => v.push_str("&gt;"),
            '"' => v.push_str("&quot;"),
            '\'' => v.push_str("&#39;"),
            c => v.push(c),
        }
    }
    v
}

/// marked's cleanUrl: encodeURI, keeping existing escapes.
fn clean_url(p_href: &str) -> String {
    let mut v = String::new();
    for b in p_href.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || ";,/?:@&=+$-_.!~*'()#%".contains(c) {
            v.push(c);
        } else {
            v.push_str(&format!("%{:02X}", b));
        }
    }
    v
}

/// Writes the events the way marked's renderer formats HTML.
fn marked_html(p_events: Vec<Event<'_>>) -> String {
    use pulldown_cmark::{Alignment, CodeBlockKind, HeadingLevel};
    let mut v = String::new();
    let mut v_aligns: Vec<Alignment> = Vec::new();
    let mut v_cell = 0usize;
    let mut v_in_head = false;
    let mut v_body_open = false;
    let mut v_code: Option<String> = None;
    // image alt text collection: (src, title, alt)
    let mut v_image: Option<(String, String, String)> = None;
    let level = |l: HeadingLevel| l as usize;
    for ev in p_events {
        if let Some((_, _, alt)) = v_image.as_mut() {
            match &ev {
                Event::End(TagEnd::Image) => {}
                Event::Text(t) | Event::Code(t) => {
                    alt.push_str(t);
                    continue;
                }
                _ => continue,
            }
        }
        if let Some(code) = v_code.as_mut() {
            match &ev {
                Event::Text(t) => {
                    code.push_str(t);
                    continue;
                }
                Event::End(TagEnd::CodeBlock) => {}
                _ => continue,
            }
        }
        match ev {
            Event::Start(t) => match t {
                Tag::Paragraph => v.push_str("<p>"),
                Tag::Heading { level: l, .. } => v.push_str(&format!("<h{}>", level(l))),
                Tag::BlockQuote(_) => v.push_str("<blockquote>\n"),
                Tag::CodeBlock(k) => {
                    match k {
                        CodeBlockKind::Fenced(info) if !info.trim().is_empty() => {
                            let v_lang = info.split_whitespace().next().unwrap_or("");
                            v.push_str(&format!("<pre><code class=\"language-{}\">", escape(v_lang)));
                        }
                        _ => v.push_str("<pre><code>"),
                    }
                    v_code = Some(String::new());
                }
                Tag::List(Some(n)) => {
                    if n == 1 {
                        v.push_str("<ol>\n");
                    } else {
                        v.push_str(&format!("<ol start=\"{}\">\n", n));
                    }
                }
                Tag::List(None) => v.push_str("<ul>\n"),
                Tag::Item => v.push_str("<li>"),
                Tag::Table(a) => {
                    v_aligns = a;
                    v_body_open = false;
                    v.push_str("<table>\n");
                }
                Tag::TableHead => {
                    v_in_head = true;
                    v_cell = 0;
                    v.push_str("<thead>\n<tr>\n");
                }
                Tag::TableRow => {
                    if !v_body_open {
                        v.push_str("<tbody>");
                        v_body_open = true;
                    }
                    v_cell = 0;
                    v.push_str("<tr>\n");
                }
                Tag::TableCell => {
                    let v_tag = if v_in_head { "th" } else { "td" };
                    let v_align = match v_aligns.get(v_cell) {
                        Some(Alignment::Left) => " align=\"left\"",
                        Some(Alignment::Right) => " align=\"right\"",
                        Some(Alignment::Center) => " align=\"center\"",
                        _ => "",
                    };
                    v.push_str(&format!("<{}{}>", v_tag, v_align));
                }
                Tag::Emphasis => v.push_str("<em>"),
                Tag::Strong => v.push_str("<strong>"),
                Tag::Strikethrough => v.push_str("<del>"),
                Tag::Link { dest_url, title, .. } => {
                    v.push_str(&format!("<a href=\"{}\"", clean_url(&dest_url)));
                    if !title.is_empty() {
                        v.push_str(&format!(" title=\"{}\"", escape(&title)));
                    }
                    v.push('>');
                }
                Tag::Image { dest_url, title, .. } => {
                    v_image = Some((clean_url(&dest_url), title.to_string(), String::new()));
                }
                _ => {}
            },
            Event::End(t) => match t {
                TagEnd::Paragraph => v.push_str("</p>\n"),
                TagEnd::Heading(l) => v.push_str(&format!("</h{}>\n", level(l))),
                TagEnd::BlockQuote(_) => v.push_str("</blockquote>\n"),
                TagEnd::CodeBlock => {
                    let v_text = v_code.take().unwrap_or_default();
                    let v_text = v_text.strip_suffix('\n').unwrap_or(&v_text);
                    v.push_str(&escape(v_text));
                    v.push_str("\n</code></pre>\n");
                }
                TagEnd::List(true) => v.push_str("</ol>\n"),
                TagEnd::List(false) => v.push_str("</ul>\n"),
                TagEnd::Item => v.push_str("</li>\n"),
                TagEnd::Table => {
                    if v_body_open {
                        v.push_str("</tbody>");
                    }
                    v.push_str("</table>\n");
                }
                TagEnd::TableHead => {
                    v_in_head = false;
                    v.push_str("</tr>\n</thead>\n");
                }
                TagEnd::TableRow => v.push_str("</tr>\n"),
                TagEnd::TableCell => {
                    let v_tag = if v_in_head { "th" } else { "td" };
                    v.push_str(&format!("</{}>\n", v_tag));
                    v_cell += 1;
                }
                TagEnd::Emphasis => v.push_str("</em>"),
                TagEnd::Strong => v.push_str("</strong>"),
                TagEnd::Strikethrough => v.push_str("</del>"),
                TagEnd::Link => v.push_str("</a>"),
                TagEnd::Image => {
                    if let Some((src, title, alt)) = v_image.take() {
                        v.push_str(&format!("<img src=\"{}\" alt=\"{}\"", src, escape(&alt)));
                        if !title.is_empty() {
                            v.push_str(&format!(" title=\"{}\"", escape(&title)));
                        }
                        v.push('>');
                    }
                }
                _ => {}
            },
            Event::Text(t) => v.push_str(&escape(&t)),
            Event::Code(t) => v.push_str(&format!("<code>{}</code>", escape(&t))),
            Event::Html(t) | Event::InlineHtml(t) => v.push_str(&t),
            Event::SoftBreak => v.push('\n'),
            Event::HardBreak => v.push_str("<br>"),
            Event::Rule => v.push_str("<hr>\n"),
            Event::TaskListMarker(c) => v.push_str(if c {
                "<input checked=\"\" disabled=\"\" type=\"checkbox\"> "
            } else {
                "<input disabled=\"\" type=\"checkbox\"> "
            }),
            _ => {}
        }
    }
    v
}

/// GET /wiki/images/:filename (None: the 404 page).
pub fn image(p_req: &Request, p_root: &Path, p_name: &str, p_headers: Vec<(String, String)>) -> Option<Response> {
    let v_name = Path::new(p_name).file_name()?.to_string_lossy().into_owned();
    let v_ext = Path::new(&v_name).extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))?;
    let v_mime = match v_ext.as_str() {
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".svg" => "image/svg+xml",
        ".webp" => "image/webp",
        _ => return None,
    };
    let v_path = wiki_dir(p_root).join("images").join(&v_name);
    let mut r = Response::with_headers(&p_headers);
    r.set("Content-Type", v_mime);
    match super::serve_file(p_req, &v_path, r) {
        Some(r) => Some(r),
        None => {
            // sendFile's error goes to the default error handler
            let v_msg = format!("ENOENT: no such file or directory, stat '{}'", v_path.display());
            eprintln!("Error: {}", v_msg);
            Some(Response::error_page(&p_headers, 404, "Error", &v_msg))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_rewritten() {
        let v_dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(v_dir.path().join("wiki")).unwrap();
        std::fs::write(
            v_dir.path().join("wiki/A.md"),
            "# Alpha\n\nSee [b](B.md), [x](../other/X.md) and ![i](images/p.png) [w](https://e.org).\n",
        )
        .unwrap();
        std::fs::write(v_dir.path().join("wiki/B.md"), "no heading\n").unwrap();
        let v_html = render(v_dir.path(), "A", Some("g1")).unwrap();
        assert!(v_html.contains("<a href=\"/admin/g1/wiki/B\">b</a>"), "{}", v_html);
        assert!(v_html.contains("x <small class=\"text-muted\">(external)</small>"), "{}", v_html);
        assert!(v_html.contains("<img src=\"/admin/g1/wiki/images/p.png\" alt=\"i\">"), "{}", v_html);
        assert!(v_html.contains("href=\"https://e.org\""));
        assert!(render(v_dir.path(), "../wiki/A", None).is_some());
        assert!(render(v_dir.path(), "../A", None).is_none());
        let v_pages = pages(v_dir.path());
        assert_eq!(v_pages, vec![json!({"name": "A", "title": "Alpha"}), json!({"name": "B", "title": "B"})]);
    }
}
