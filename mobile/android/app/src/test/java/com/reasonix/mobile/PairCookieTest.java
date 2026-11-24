package com.reasonix.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PairCookieTest {
    @Test
    public void readsTheDeviceCredentialFromAHeader() {
        assertEquals("abc", PairCookie.value("other=1; reasonix_device=abc; tail=2"));
    }

    @Test
    public void trimsTheSpacingAroundTheValue() {
        assertEquals("abc", PairCookie.value(" reasonix_device = abc "));
    }

    @Test
    public void anEmptyValueIsNotACredential() {
        assertEquals("", PairCookie.value("reasonix_device="));
    }

    @Test
    public void ignoresNamesThatOnlyStartTheSameWay() {
        assertEquals("", PairCookie.value("reasonix_device_old=abc"));
    }

    @Test
    public void handlesAMissingHeader() {
        assertEquals("", PairCookie.value(null));
        assertEquals("", PairCookie.value(""));
    }
}
