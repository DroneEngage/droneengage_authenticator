//! The headers every response starts with: helmet v3 (with its
//! user-agent dependent Content-Security-Policy header names) and cors().

/// The app-wide CSP directives (server.js).
pub const CSP_APP: &[(&str, &str)] = &[
    ("default-src", "'self'"),
    ("style-src", "'self' 'unsafe-inline'"),
    ("script-src", "'self' 'unsafe-inline'"),
    ("script-src-attr", "'unsafe-inline'"),
    ("upgrade-insecure-requests", ""),
];

/// The /admin router's CSP directives (js_router_admin.js).
pub const CSP_ADMIN: &[(&str, &str)] = &[
    ("default-src", "'self'"),
    ("script-src", "'self' 'unsafe-inline'"),
    ("script-src-attr", "'unsafe-inline'"),
    ("style-src", "'self' 'unsafe-inline'"),
    ("img-src", "'self' data:"),
    ("font-src", "'self'"),
    ("connect-src", "'self'"),
    ("frame-src", "'none'"),
    ("object-src", "'none'"),
    ("base-uri", "'self'"),
    ("form-action", "'self'"),
    ("frame-ancestors", "'none'"),
];

fn build(p_directives: &[(String, String)]) -> String {
    p_directives
        .iter()
        .map(|(k, v)| if v.is_empty() { k.clone() } else { format!("{} {}", k, v) })
        .collect::<Vec<_>>()
        .join("; ")
}

/// transformDirectivesForPreCsp1Firefox
fn pre_csp1_firefox(p_directives: &[(&str, &str)], p_base: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut v = p_base;
    let put = |v: &mut Vec<(String, String)>, k: &str, val: &str| match v.iter_mut().find(|(n, _)| n == k) {
        Some(e) => e.1 = val.to_string(),
        None => v.push((k.to_string(), val.to_string())),
    };
    if let Some((_, c)) = p_directives.iter().find(|(k, _)| *k == "connect-src") {
        put(&mut v, "xhr-src", c);
    }
    for (k, val) in p_directives.iter().filter(|(k, _)| *k != "connect-src") {
        put(&mut v, k, val);
    }
    if let Some((_, s)) = p_directives.iter().find(|(k, _)| *k == "script-src") {
        let mut v_opts = Vec::new();
        if s.contains("'unsafe-inline'") {
            v_opts.push("inline-script");
        }
        if s.contains("'unsafe-eval'") {
            v_opts.push("eval-script");
        }
        if !v_opts.is_empty() {
            put(&mut v, "options", &v_opts.join(" "));
        }
    }
    v
}

/// The CSP value for a User-Agent (helmet-csp transforms the directives
/// for Firefox before CSP 1.0).
pub fn csp_value(p_directives: &[(&str, &str)], p_ua: Option<&str>) -> String {
    let v_plain: Vec<(String, String)> = p_directives.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let Some(v_ua) = p_ua.filter(|u| !u.is_empty()) else { return build(&v_plain) };
    let v_firefox = (v_ua.contains("Firefox/") || v_ua.contains("FxiOS/"))
        && !(v_ua.contains("Edg/") || v_ua.contains("OPR/") || v_ua.contains("Opera"));
    let v_ios = v_ua.contains("iPhone") || v_ua.contains("iPad") || v_ua.contains("iPod");
    if !v_firefox || v_ios {
        return build(&v_plain);
    }
    let v = version_after(v_ua, "Firefox/").unwrap_or(0.0);
    let v_android = v_ua.to_ascii_lowercase().contains("android");
    let v_star = vec![("default-src".to_string(), "*".to_string())];
    if (v_android && v < 25.0) || (v_ua.contains("Mobile") && v < 32.0) {
        return build(&pre_csp1_firefox(p_directives, v_star));
    }
    if (4.0..23.0).contains(&v) {
        if v < 5.0 {
            let v_default = p_directives.iter().find(|(k, _)| *k == "default-src").map(|(_, d)| *d);
            let v_rest: Vec<(&str, &str)> = p_directives.iter().filter(|(k, _)| *k != "default-src").copied().collect();
            let v_base = vec![("allow".to_string(), v_default.unwrap_or("*").to_string())];
            return build(&pre_csp1_firefox(&v_rest, v_base));
        }
        return build(&pre_csp1_firefox(p_directives, v_star));
    }
    build(&v_plain)
}

const ALL: [&str; 3] = ["Content-Security-Policy", "X-Content-Security-Policy", "X-WebKit-CSP"];

fn version_after(p_ua: &str, p_marker: &str) -> Option<f64> {
    let i = p_ua.find(p_marker)? + p_marker.len();
    let v: String = p_ua[i..].chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let mut v_parts = v.split('.');
    let v_major = v_parts.next().filter(|s| !s.is_empty())?;
    let v_text = match v_parts.next() {
        Some(m) if !m.is_empty() => format!("{}.{}", v_major, m),
        _ => v_major.to_string(),
    };
    v_text.parse().ok()
}

/// helmet-csp's header names for a User-Agent (bowser's browser detection,
/// for the browsers helmet-csp distinguishes; anything else gets all three).
pub fn csp_header_names(p_ua: Option<&str>) -> Vec<&'static str> {
    let Some(v_ua) = p_ua.filter(|u| !u.is_empty()) else { return ALL.to_vec() };
    let v_ios = v_ua.contains("iPhone") || v_ua.contains("iPad") || v_ua.contains("iPod");
    let v_android = v_ua.to_ascii_lowercase().contains("android") && !v_ua.contains("Windows Phone");
    let v_csp = vec!["Content-Security-Policy"];
    if v_ua.contains("Edg/") || v_ua.contains("Edge/") || v_ua.contains("EdgA/") || v_ua.contains("EdgiOS/") {
        return v_csp;
    }
    if v_ua.contains("OPR/") || v_ua.contains("Opera") {
        let v = version_after(v_ua, "OPR/")
            .or_else(|| version_after(v_ua, "Version/"))
            .or_else(|| version_after(v_ua, "Opera/"));
        return if v.map(|v| v >= 15.0).unwrap_or(false) { v_csp } else { vec![] };
    }
    if v_ua.contains("MSIE ") || v_ua.contains("Trident/") {
        let v = version_after(v_ua, "MSIE ").or_else(|| version_after(v_ua, "rv:")).unwrap_or(0.0);
        return vec![if v < 12.0 { "X-Content-Security-Policy" } else { "Content-Security-Policy" }];
    }
    if v_ua.contains("Firefox/") || v_ua.contains("FxiOS/") {
        if v_ios {
            return v_csp;
        }
        let v = version_after(v_ua, "Firefox/").unwrap_or(0.0);
        if v_android {
            return vec![if v >= 25.0 { "Content-Security-Policy" } else { "X-Content-Security-Policy" }];
        }
        if v_ua.contains("Mobile") {
            return vec![if v >= 32.0 { "Content-Security-Policy" } else { "X-Content-Security-Policy" }];
        }
        return if v >= 23.0 {
            v_csp
        } else if v >= 4.0 {
            vec!["X-Content-Security-Policy"]
        } else {
            vec![]
        };
    }
    if v_ua.contains("CriOS/") {
        return v_csp;
    }
    if v_ua.contains("Chrome/") || v_ua.contains("Chromium/") {
        let v = version_after(v_ua, "Chrome/").or_else(|| version_after(v_ua, "Chromium/")).unwrap_or(0.0);
        if v_android && v_ua.contains("Mobile") {
            return v_csp;
        }
        return if (14.0..25.0).contains(&v) {
            vec!["X-WebKit-CSP"]
        } else if v >= 25.0 {
            v_csp
        } else {
            vec![]
        };
    }
    if v_android {
        // Android Browser: 4.4 and later
        let v = version_after(v_ua, "Android ").unwrap_or(0.0);
        return if v != 0.0 && v < 4.4 { vec![] } else { v_csp };
    }
    if v_ua.contains("Safari/") && v_ua.contains("Version/") {
        let v = version_after(v_ua, "Version/").unwrap_or(0.0);
        return if v >= 7.0 {
            v_csp
        } else if v >= 6.0 {
            vec!["X-WebKit-CSP"]
        } else {
            vec![]
        };
    }
    ALL.to_vec()
}

/// helmet() with the app CSP, then cors(): the headers in Node's order.
pub fn base(p_ua: Option<&str>) -> Vec<(String, String)> {
    let v_csp = csp_value(CSP_APP, p_ua);
    let mut v: Vec<(String, String)> =
        csp_header_names(p_ua).into_iter().map(|n| (n.to_string(), v_csp.clone())).collect();
    for (k, val) in [
        ("X-DNS-Prefetch-Control", "off"),
        ("X-Frame-Options", "SAMEORIGIN"),
        ("Strict-Transport-Security", "max-age=15552000; includeSubDomains"),
        ("X-Download-Options", "noopen"),
        ("X-Content-Type-Options", "nosniff"),
        ("X-XSS-Protection", "1; mode=block"),
        ("Access-Control-Allow-Origin", "*"),
    ] {
        v.push((k.to_string(), val.to_string()));
    }
    v
}

/// The admin router's contentSecurityPolicy over p_headers: existing names
/// keep their place, new ones are appended.
pub fn admin_csp(p_headers: &mut Vec<(String, String)>, p_ua: Option<&str>) {
    let v_csp = csp_value(CSP_ADMIN, p_ua);
    for n in csp_header_names(p_ua) {
        match p_headers.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(n)) {
            Some(h) => h.1 = v_csp.clone(),
            None => p_headers.push((n.to_string(), v_csp.clone())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_names_by_browser() {
        assert_eq!(csp_header_names(None).len(), 3);
        assert_eq!(csp_header_names(Some("curl/8.0")).len(), 3);
        let v_chrome =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        assert_eq!(csp_header_names(Some(v_chrome)), ["Content-Security-Policy"]);
        let v_ff = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
        assert_eq!(csp_header_names(Some(v_ff)), ["Content-Security-Policy"]);
        assert_eq!(
            csp_header_names(Some("Mozilla/5.0 (Windows NT 6.1; rv:10.0) Gecko/20100101 Firefox/10.0")),
            ["X-Content-Security-Policy"]
        );
        let v_safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
        assert_eq!(csp_header_names(Some(v_safari)), ["Content-Security-Policy"]);
        assert_eq!(base(None)[3].0, "X-DNS-Prefetch-Control");
    }
}
