package com.reasonix.mobile;

import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The upstream cookie jar, plus the WebView jar the account flow reads. */
final class ProxyCookies {
    private final CookieManager jar = new CookieManager(null, CookiePolicy.ACCEPT_ALL);

    void store(URI uri, HttpURLConnection conn) throws IOException {
        Map<String, List<String>> response = new HashMap<>();
        for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
            if (entry.getKey() != null && "set-cookie".equalsIgnoreCase(entry.getKey())) {
                response.put("Set-Cookie", entry.getValue());
            }
        }
        if (!response.isEmpty()) jar.put(uri, response);
    }

    /**
     * Every cookie this app holds for one upstream, read from both jars and
     * merged by name.
     *
     * A code scanned into the pairing WebView leaves the credential in the
     * WebView's CookieManager; a code handed to this proxy itself leaves it in
     * this class's memory jar. Neither jar is reliably a superset of the other,
     * so a caller that picked one and ignored the other could reach the kernel
     * carrying no credential at all — and a kernel holding no credential answers
     * "not paired", which is the same answer it gives a phone that never paired.
     *
     * The WebView's copy wins a name both jars hold: that is the jar the person
     * paired in, and the one a re-pair rewrites.
     */
    String forOrigin(String origin) {
        if (origin == null || origin.isEmpty()) return "";
        List<String> sources = new ArrayList<>();
        sources.add(webCookie(cookieUrl(origin)));
        sources.addAll(memoryCookies(origin));
        return merge(sources);
    }

    /**
     * The URL every jar is asked about, spelled one way for one door.
     *
     * A door arrives both with and without the scheme's own port: the proxy
     * normalizes `https://host` to `https://host:443` before it stores an
     * origin, while the pairing page was loaded as `https://host/`. Cookies are
     * matched by host, so the port settles nothing — but two spellings ask two
     * questions, and a jar that answered one of them reads as "this phone holds
     * no credential", which is the answer a phone that never paired gives.
     *
     * The scheme's own port is therefore dropped rather than added: the page's
     * own spelling is what the WebView jar was written under, and every jar is
     * read through this one function so the two can no longer drift apart.
     */
    static String cookieUrl(String origin) {
        String clean = origin == null ? "" : origin.trim();
        if (clean.isEmpty()) return "";
        while (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
        if (clean.startsWith("https://") && clean.endsWith(":443")) {
            clean = clean.substring(0, clean.length() - 4);
        } else if (clean.startsWith("http://") && clean.endsWith(":80")) {
            clean = clean.substring(0, clean.length() - 3);
        }
        return clean + "/";
    }

    /** The memory jar's cookie headers for one origin, one entry per header line. */
    private List<String> memoryCookies(String origin) {
        List<String> out = new ArrayList<>();
        Map<String, List<String>> request;
        try {
            request = jar.get(URI.create(origin + "/"), new HashMap<>());
        } catch (Exception e) {
            return out;
        }
        for (List<String> values : request.values()) out.addAll(values);
        return out;
    }

    /**
     * Fold several cookie headers into one, first name winning.
     *
     * `a=1; b=2` and `b=9` merge to `a=1; b=2`: the earlier source is the one
     * with the better claim on a name it already spelled. Duplicate names in one
     * header are the same as duplicates across headers — the first stands, which
     * is what stops a stale copy from displacing a fresh one.
     */
    static String merge(List<String> sources) {
        Map<String, String> merged = new LinkedHashMap<>();
        for (String source : sources) {
            if (source == null) continue;
            for (String part : source.split(";")) {
                putUnlessHeld(merged, part);
            }
        }
        if (merged.isEmpty()) return "";
        StringBuilder out = new StringBuilder();
        for (Map.Entry<String, String> entry : merged.entrySet()) {
            if (out.length() > 0) out.append("; ");
            out.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return out.toString();
    }

    /** Record one `name=value` unless a source with better claim already named it. */
    private static void putUnlessHeld(Map<String, String> merged, String pair) {
        if (pair == null) return;
        String trimmed = pair.trim();
        int equals = trimmed.indexOf('=');
        if (equals <= 0) return;
        String name = trimmed.substring(0, equals).trim();
        if (name.isEmpty() || merged.containsKey(name)) return;
        merged.put(name, trimmed.substring(equals + 1).trim());
    }

    /** The CookieManager cookie for any origin a WebView paired with. */
    static String webCookie(String url) {
        try {
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            return cookie == null ? "" : cookie;
        } catch (RuntimeException e) {
            return "";
        }
    }
}
