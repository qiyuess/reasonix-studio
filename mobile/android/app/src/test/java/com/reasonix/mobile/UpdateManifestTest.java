package com.reasonix.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateManifestTest {
    // The phone app keeps its own version in the manifest; the download rides
    // the latest Studio release, which carries the APK of that same version.
    private static final String MANIFEST =
            "{\"tag\":\"v1.1.1\",\"version\":\"1.1.1\",\"versionCode\":32,"
                    + "\"apk\":\"reasonix-for-android-1.1.1.apk\","
                    + "\"notes\":\"修复连接\","
                    + "\"mirrors\":[\"https://gh-proxy.com/https://github.com/x/y.apk\","
                    + "\"http://plain.example/y.apk\"]}";

    @Test
    public void readsAReleaseManifest() {
        UpdateManifest manifest = UpdateManifest.parse(MANIFEST);

        assertEquals("v1.1.1", manifest.tag());
        assertEquals("1.1.1", manifest.version());
        assertEquals(32, manifest.versionCode());
        assertEquals("reasonix-for-android-1.1.1.apk", manifest.apk());
        assertEquals("修复连接", manifest.notes());
        assertEquals(1, manifest.mirrors().size());
        assertEquals(
                "https://github.com/qiyuess/reasonix-studio/releases/latest/download/"
                        + "reasonix-for-android-1.1.1.apk",
                manifest.apkUrl("qiyuess/reasonix-studio"));
    }

    @Test
    public void offersOnlyVersionsNewerThanTheInstalledCode() {
        UpdateManifest manifest = UpdateManifest.parse(MANIFEST);

        assertTrue(manifest.isNewerThan(31));
        assertFalse(manifest.isNewerThan(32));
        assertFalse(manifest.isNewerThan(33));
    }

    @Test
    public void rejectsAVersionCodeThatIsMissing() {
        String json = MANIFEST.replace("\"versionCode\":32,", "");

        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse(json));
    }

    @Test
    public void rejectsAVersionTheApkNameDisagreesWith() {
        String json = MANIFEST.replace(
                "reasonix-for-android-1.1.1.apk", "reasonix-for-android-0.2.2.apk");

        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse(json));
    }

    @Test
    public void rejectsATagThatDisagreesWithTheVersion() {
        String json = MANIFEST.replace("\"version\":\"1.1.1\"", "\"version\":\"1.1.2\"");

        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse(json));
    }

    @Test
    public void rejectsAnApkNameThatCouldLeaveTheReleaseDirectory() {
        String json = MANIFEST.replace(
                "reasonix-for-android-1.1.1.apk", "../reasonix-for-android-1.1.1.apk");

        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse(json));
    }

    @Test
    public void rejectsAnUnreadableBodyAndAForeignTag() {
        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse("not json"));
        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse("{}"));
        assertThrows(
                IllegalArgumentException.class,
                () -> UpdateManifest.parse(MANIFEST.replace("\"v1.1.1\"", "\"1.1.1\"")));
    }
}
