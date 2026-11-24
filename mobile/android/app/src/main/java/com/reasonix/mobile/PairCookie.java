package com.reasonix.mobile;

/** The device credential in a CookieManager header, parsed the one way the
 *  pairing sheet reads it. */
final class PairCookie {
    private PairCookie() {}

    static String value(String header) {
        if (header == null) return "";
        for (String part : header.split(";")) {
            String trimmed = part.trim();
            int equals = trimmed.indexOf('=');
            if (equals <= 0) continue;
            if (trimmed.substring(0, equals).trim().equals("reasonix_device")) {
                return trimmed.substring(equals + 1).trim();
            }
        }
        return "";
    }
}
