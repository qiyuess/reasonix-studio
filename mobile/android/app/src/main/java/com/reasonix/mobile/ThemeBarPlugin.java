package com.reasonix.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the system bar to match the page.
 *
 * The status bar is not part of the WebView: below WebView 140 Capacitor pads
 * the WebView down by the inset instead of laying it under the bar, so the
 * strip above the content belongs to the window. Two surfaces draw it:
 * `Window.setStatusBarColor` and the decor view's own background, which
 * Capacitor's SystemBars plugin sets from the *system* theme whenever its
 * bridge initialises. The app can pin its appearance independently, so
 * following the system leaves a band of the other palette above the page —
 * and setting only the status bar colour leaves the decor's band behind.
 * Both surfaces are painted here.
 *
 * The page, which knows which background it actually drew, reports it. That
 * report is also persisted: a cold start has no WebView yet, and the window
 * should already be the right colour before the first frame. Each application
 * is posted twice so a SystemBars pass queued during bridge startup cannot
 * win by landing last.
 */
@CapacitorPlugin(name = "ThemeBar")
public class ThemeBarPlugin extends Plugin {

    private static final String PREFS = "reasonix_theme_bar";
    private static final String KEY_COLOR = "color";
    private static final String KEY_DARK_ICONS = "dark_icons";
    private static final String KEY_HAS_ICONS = "has_icons";

    /** Cached in-process too, so a resume does not need a disk read. */
    private static volatile String lastColor = "";
    private static volatile Boolean lastDarkIcons = null;

    @PluginMethod
    public void setAppearance(PluginCall call) {
        String color = call.getString("color", "");
        Boolean darkIcons = call.getBoolean("darkIcons");
        Activity activity = getActivity();
        if (activity == null || color.isEmpty()) {
            call.resolve();
            return;
        }
        remember(activity, color, darkIcons);
        // Plugin methods run on a handler thread; every View touch must hop.
        final String appliedColor = lastColor;
        final Boolean appliedIcons = lastDarkIcons;
        activity.runOnUiThread(() -> applyTwice(activity, appliedColor, appliedIcons));
        call.resolve();
    }

    /**
     * Restore the remembered appearance on a warm start or a resume.
     *
     * Called after super.onCreate (once the bridge has queued SystemBars' own
     * init) and from onResume. Each application also posts a trailing pass, so
     * a SystemBars repaint that lands later cannot win by arriving last.
     */
    static void reapply(Activity activity) {
        if (activity == null) return;
        final String color;
        final Boolean darkIcons;
        if (lastColor.isEmpty()) {
            SharedPreferences prefs = prefs(activity);
            color = prefs.getString(KEY_COLOR, "");
            darkIcons = prefs.getBoolean(KEY_HAS_ICONS, false)
                    ? prefs.getBoolean(KEY_DARK_ICONS, false) : null;
            if (color.isEmpty()) return;
            lastColor = color;
            lastDarkIcons = darkIcons;
        } else {
            color = lastColor;
            darkIcons = lastDarkIcons;
        }
        activity.runOnUiThread(() -> applyTwice(activity, color, darkIcons));
    }

    /**
     * Dress a translucent surface — the pairing sheet — in the app's bar
     * appearance without painting the window. The decor stays transparent so
     * the app behind is the backdrop; colouring it would turn the sheet into a
     * full-screen panel.
     */
    static void dressTranslucent(Activity activity) {
        if (activity == null) return;
        final boolean darkIcons = rememberedLightIcons(activity);
        activity.runOnUiThread(() -> {
            applyTranslucent(activity, darkIcons);
            View decor = activity.getWindow() == null ? null : activity.getWindow().getDecorView();
            if (decor != null) decor.post(() -> applyTranslucent(activity, darkIcons));
        });
    }

    private static void applyTranslucent(Activity activity, boolean darkIcons) {
        Window window = activity.getWindow();
        if (window == null) return;
        // Target 36 enforces edge-to-edge, where setStatusBarColor is a no-op:
        // the sheet draws its own strip under the clear bar instead.
        window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        View decor = window.getDecorView();
        decor.setBackgroundColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons);
    }

    private static void remember(Activity activity, String color, Boolean darkIcons) {
        lastColor = color;
        if (darkIcons != null) lastDarkIcons = darkIcons;
        SharedPreferences.Editor editor = prefs(activity).edit()
                .putString(KEY_COLOR, color);
        if (darkIcons != null) {
            editor.putBoolean(KEY_HAS_ICONS, true).putBoolean(KEY_DARK_ICONS, darkIcons);
        }
        editor.apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The remembered bar colour, or "" before the page has ever reported one.
     *
     * A surface the page does not paint — the pairing sheet — reads this to
     * dress itself in the same palette, so its card and its buttons answer the
     * theme instead of a hard-coded light grey.
     */
    static String rememberedColor(Context context) {
        if (!lastColor.isEmpty()) return lastColor;
        return prefs(context).getString(KEY_COLOR, "");
    }

    /**
     * Whether the remembered bar is light (dark icons), or true when unknown —
     * the app has shipped light-first, so an unrecorded install reads light.
     */
    static boolean rememberedLightIcons(Context context) {
        if (lastDarkIcons != null) return lastDarkIcons;
        SharedPreferences prefs = prefs(context);
        return prefs.getBoolean(KEY_HAS_ICONS, false)
                ? prefs.getBoolean(KEY_DARK_ICONS, false)
                : true;
    }

    private static void applyTwice(Activity activity, String color, Boolean darkIcons) {
        apply(activity, color, darkIcons);
        Window window = activity.getWindow();
        if (window == null) return;
        View decor = window.getDecorView();
        // Queued behind whatever SystemBars posted during bridge startup.
        decor.post(() -> apply(activity, color, darkIcons));
    }

    private static void apply(Activity activity, String color, Boolean darkIcons) {
        Window window = activity.getWindow();
        if (window == null) return;
        int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException ignored) {
            // A colour the page could not have produced; keep the last one.
            return;
        }
        window.setStatusBarColor(parsed);
        View decor = window.getDecorView();
        decor.setBackgroundColor(parsed);
        if (darkIcons != null) {
            // "Light status bars" is Android's name for a light background,
            // which is what makes the system draw dark icons on it.
            WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, decor);
            controller.setAppearanceLightStatusBars(darkIcons);
        }
    }
}
