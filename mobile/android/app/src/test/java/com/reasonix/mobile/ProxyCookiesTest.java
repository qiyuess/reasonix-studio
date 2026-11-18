package com.reasonix.mobile;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

/**
 * The two cookie jars, folded into the one header a forwarded request carries.
 *
 * A phone that scanned its pairing code keeps the credential in the WebView's
 * CookieManager; one that handed the code to the proxy keeps it in the memory
 * jar. A request that carried only one of them looked unpaired to the kernel.
 */
public class ProxyCookiesTest {
    @Test
    public void keepsBothJarsWhenEachHoldsSomethingTheOtherDoesNot() {
        assertEquals(
                "reasonix_device=device-1; reasonix_loopback=loop-1",
                ProxyCookies.merge(Arrays.asList("reasonix_device=device-1", "reasonix_loopback=loop-1")));
    }

    @Test
    public void theFirstSourceKeepsANameItAlreadySpelled() {
        // The shared name keeps the first source's value; the second source's
        // own cookie is still carried, because dropping it would lose a
        // credential the kernel may be asking for.
        assertEquals("reasonix_device=web-copy; other=2", ProxyCookies.merge(Arrays.asList(
                "reasonix_device=web-copy", "reasonix_device=jar-copy; other=2")));
    }

    @Test
    public void splitsSeveralCookiesOutOfOneHeader() {
        assertEquals("a=1; b=2", ProxyCookies.merge(Collections.singletonList("a=1; b=2")));
    }

    @Test
    public void trimsTheSpacingAHeaderArrivesWith() {
        assertEquals("a=1; b=2", ProxyCookies.merge(Collections.singletonList("  a=1 ;  b=2  ")));
    }

    @Test
    public void anEmptyJarIsNotACookie() {
        assertEquals("", ProxyCookies.merge(Arrays.asList("", null, "   ")));
        assertEquals("", ProxyCookies.merge(Collections.emptyList()));
    }

    @Test
    public void ignoresFragmentsThatAreNotANameAndAValue() {
        assertEquals("a=1", ProxyCookies.merge(Collections.singletonList("a=1; novalue; =2; ")));
    }

    @Test
    public void keepsAnEmptyValueBecauseAPairMayClearACookie() {
        assertEquals("a=", ProxyCookies.merge(Collections.singletonList("a=")));
    }

    @Test
    public void oneDoorHasOneSpellingWhateverPortItWasStoredUnder() {
        // The proxy normalizes a door to `https://host:443` before it stores an
        // origin; the pairing page was loaded as `https://host/`. Cookies match
        // by host, but two spellings ask two questions — and the jar that
        // answered the other one reads as a phone holding no credential.
        assertEquals("https://agent.example.com/", ProxyCookies.cookieUrl("https://agent.example.com"));
        assertEquals("https://agent.example.com/", ProxyCookies.cookieUrl("https://agent.example.com:443"));
        assertEquals("https://agent.example.com/", ProxyCookies.cookieUrl("https://agent.example.com/"));
        assertEquals("http://10.0.0.5:10086/", ProxyCookies.cookieUrl("http://10.0.0.5:10086"));
        assertEquals("http://agent.example.com/", ProxyCookies.cookieUrl("http://agent.example.com:80"));
    }

    @Test
    public void aDoorWithNoNameHasNoCookieUrl() {
        assertEquals("", ProxyCookies.cookieUrl(""));
        assertEquals("", ProxyCookies.cookieUrl(null));
    }
}
