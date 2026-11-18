package com.reasonix.mobile;

import android.annotation.SuppressLint;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

/**
 * The Studio share page, loaded invisibly to spend a pairing code.
 *
 * The page's own `#pair=` bootstrap is the path a browser uses and the one
 * known to pair; the direct proxy POST has been refused on codes the page
 * accepts. This activity shows only a small "正在配对" card while a 2x2
 * WebView loads the same link. It succeeds when the `reasonix_device` cookie
 * appears, then finishes and hands the result to PairPlugin.
 */
@SuppressLint("SetJavaScriptEnabled")
public class PairActivity extends ComponentActivity {
    private static final long TIMEOUT_MS = 15_000;
    static final String EXTRA_REASON = "reason";

    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Kept for onDestroy: an invisible WebView with JS running still leaks if only GC'd. */
    private WebView web;
    private String origin = "";
    private long startedAt;
    private boolean done;
    /**
     * The `reasonix_device` cookie this phone already held when the sheet opened.
     *
     * Pairing is judged by a *change* from this value, never by the cookie
     * merely being there. A phone that paired once keeps a copy for thirty days;
     * asking "is the cookie present" therefore answered yes before the page had
     * even loaded, so the sheet reported a pairing that never happened and the
     * proxy went on to carry the stale credential — which the kernel answers
     * with "this device is not paired", the same answer it gives a phone that
     * was never paired at all.
     */
    private String credentialBefore = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishWith(RESULT_CANCELED, "cancelled");
            }
        });
        String url = getIntent().getStringExtra("url");
        origin = getIntent().getStringExtra("origin");
        if (!Urls.isWebUrl(url) || !Urls.isWebUrl(origin)) {
            finishWith(RESULT_CANCELED, "invalid_url");
            return;
        }
        startedAt = System.currentTimeMillis();
        // Read before the page loads, so what the page writes is a change this
        // code can see rather than the copy it could not tell apart from one.
        credentialBefore = deviceCookieValue();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        WebView web = this.web = new WebView(this);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finishWith(RESULT_CANCELED, "load_failed");
            }
        });
        web.setAlpha(0f);
        root.addView(web, new FrameLayout.LayoutParams(2, 2));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setPadding(48, 48, 48, 32);
        card.setBackgroundColor(Color.rgb(247, 248, 250));

        ProgressBar progress = new ProgressBar(this);
        TextView label = new TextView(this);
        label.setText("正在配对…");
        label.setTextSize(16);
        label.setTextColor(Color.rgb(20, 23, 28));
        label.setPadding(0, 16, 0, 20);

        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setAllCaps(false);
        cancel.setOnClickListener(v -> finishWith(RESULT_CANCELED, "cancelled"));

        card.addView(progress);
        card.addView(label);
        card.addView(cancel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.gravity = Gravity.CENTER;
        root.addView(card, cardParams);

        setContentView(root);
        web.loadUrl(url);
        handler.postDelayed(this::poll, 250);
    }

    private void poll() {
        if (done) return;
        if (hasDeviceCookie()) {
            // Persist the credential the page just set before the activity goes.
            CookieManager.getInstance().flush();
            finishWith(RESULT_OK, "paired");
            return;
        }
        if (System.currentTimeMillis() - startedAt > TIMEOUT_MS) {
            // A cookie that landed just after the last check is a success,
            // not a pairing to ask for a new code.
            CookieManager.getInstance().flush();
            boolean paired = hasDeviceCookie();
            finishWith(paired ? RESULT_OK : RESULT_CANCELED, paired ? "paired" : "timeout");
            return;
        }
        handler.postDelayed(this::poll, 250);
    }

    /**
     * Whether the page has left a credential this sheet can call its own.
     *
     * A value equal to the one this phone already held is not a pairing: the
     * page may not have answered yet, or it refused the code and left the old
     * copy in place. Only a different value proves the exchange that ran here
     * minted something new.
     */
    private boolean hasDeviceCookie() {
        String now = deviceCookieValue();
        return !now.isEmpty() && !now.equals(credentialBefore);
    }

    /**
     * The `reasonix_device=` value the cookie jar holds for this door, or "".
     *
     * Read through the proxy's own spelling of the door so the credential a
     * page writes and the credential a later request carries cannot be looked up
     * under two different URLs.
     */
    private String deviceCookieValue() {
        try {
            String cookie = CookieManager.getInstance().getCookie(ProxyCookies.cookieUrl(origin));
            if (cookie == null) return "";
            for (String part : cookie.split(";")) {
                String trimmed = part.trim();
                int equals = trimmed.indexOf('=');
                if (equals <= 0) continue;
                if (trimmed.substring(0, equals).trim().equals("reasonix_device=")) {
                    return trimmed.substring(equals + 1).trim();
                }
            }
            return "";
        } catch (RuntimeException e) {
            return "";
        }
    }

    private void finishWith(int resultCode, String reason) {
        if (done) return;
        done = true;
        Intent data = new Intent();
        data.putExtra(EXTRA_REASON, reason);
        setResult(resultCode, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
