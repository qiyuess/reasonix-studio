package com.reasonix.mobile;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Whether an activity is resumed; the turn service uses it to stay quiet. */
    public static volatile boolean visible = false;
    /** The page this activity drives; null once the screen is gone. */
    @SuppressLint("StaticFieldLeak") // Cleared in onDestroy; the service needs it while visible.
    private static volatile WebView webView;
    /** This activity's own page, so an old destroy cannot clear a newer one. */
    private WebView ownWebView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The WebView loads http://127.0.0.1:8788, so the proxy must be
        // listening before Capacitor starts its bridge, and the loopback
        // cookie must already be in this app's cookie jar.
        boolean proxyStarted = LoopbackProxy.start(getApplicationContext());
        LoopbackProxy.installWebViewCookie(getApplicationContext());
        registerPlugin(PairPlugin.class);
        registerPlugin(NetworkWatchPlugin.class);
        registerPlugin(TurnPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        registerPlugin(ThemeBarPlugin.class);
        super.onCreate(savedInstanceState);
        WebView view = getBridge() == null ? null : getBridge().getWebView();
        ownWebView = view;
        webView = view;
        if (view != null) {
            InsetBridge.install(this, view, getBridge());
        }
        // The pre-super install is the load-bearing one: Capacitor starts
        // its first navigation inside super.onCreate. This retry only helps
        // a WebView created later and is harmless if the cookie is already
        // present.
        LoopbackProxy.installWebViewCookie(getApplicationContext());
        // SystemBars initialises inside super.onCreate and paints the decor
        // with the *system* theme. A warm start has a cached page appearance;
        // put it back after the bridge has had its turn.
        ThemeBarPlugin.reapply(this);
        if (!proxyStarted) showProxyFailure();
    }

    /**
     * A blank WebView with no explanation reads as a broken build. The usual
     * cause is another process holding the fixed loopback port; retry after
     * it goes away rather than asking for a reinstall.
     */
    private void showProxyFailure() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.proxy_failed_title)
                .setMessage(R.string.proxy_failed_message)
                .setPositiveButton(R.string.proxy_failed_retry, (dialog, which) -> {
                    if (!LoopbackProxy.start(getApplicationContext())) {
                        showProxyFailure();
                        return;
                    }
                    WebView view = getBridge() == null ? null : getBridge().getWebView();
                    if (view != null) view.reload();
                })
                .setNegativeButton(R.string.proxy_failed_exit, (dialog, which) -> finish())
                .show();
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
        // A returning activity may have had its decor repainted from the
        // system theme while it was away; reassert the page's own colour.
        ThemeBarPlugin.reapply(this);
    }

    @Override
    public void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    public void onDestroy() {
        if (webView == ownWebView) webView = null;
        ownWebView = null;
        super.onDestroy();
    }

}
