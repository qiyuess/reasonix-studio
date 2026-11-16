package com.reasonix.mobile;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;


/**
 * Keeps the phone informed while agent turns run in a pocket.
 *
 * The service discovers every open pane on the active computer from
 * `GET /runtimes` and polls each pane's `/status`. A decision blocks a turn,
 * so it earns a per-session heads-up; a turn that stops after running earns a
 * completion; the ongoing notification summarizes the rest. The desktop still
 * owns the turns: this is a watcher, not a transport.
 *
 * A phone cannot see a pane the desktop never opened: every read goes through
 * the loopback proxy, to the computer this phone is on. That limit is stated
 * rather than hidden.
 */
public class TurnService extends Service {
    static final String ACTION_START = "com.reasonix.mobile.TURN_START";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BASE = "base";
    static final String EXTRA_ROOT = "root";
    static final String EXTRA_RUNTIME = "runtime";
    static final String ACTION_DECIDE = "com.reasonix.mobile.TURN_DECIDE";
    static final String EXTRA_DECISION = "decision";
    static final String EXTRA_QUESTION = "question";
    static final String EXTRA_SELECTED = "selected";
    static final String EXTRA_ALLOW = "allow";
    static final String EXTRA_SESSION = "session";
    static final String EXTRA_APPROVAL = "approval";

    private static final String TAG = "ReasonixTurn";
    private static final int RUNNING_ID = 4101;
    private static final int OFFLINE_AFTER = 3;
    private static final long WAKE_LOCK_MS = 30 * 60 * 1000L;
    private static final long WATCH_POLL_MS = 5000L;
    /** Ten minutes without one answer means the computer is gone, not slow. */
    private static final long QUIET_STOP_MS = 10 * 60 * 1000L;
    private static final int MAX_BODY = 512 * 1024;

    /** Set by the plugin before stopService; kept for the plugin's contract. */
    static volatile boolean completed;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService decisions = Executors.newSingleThreadExecutor();
    /** The running watcher, for the WebView's result bridge. */
    private static volatile TurnService active;
    private volatile int pollFailures = 0;
    private volatile boolean stopping = false;
    private ScheduledExecutorService watcher;
    private ScheduledExecutorService peerWatcher;
    private final Map<String, PaneWatch> watches = new ConcurrentHashMap<>();
    /** A failed read this pass means the pane is not proven idle. */
    private volatile boolean activeStatusFailed = false;
    /** True while a peer sweep is running or the last one failed. */
    private volatile boolean peerStatusFailed = true;
    private volatile boolean peerSweeping = false;
    /** Consecutive discovery passes with nothing running or waiting. */
    private int idlePolls = 0;
    /** Last time any proxy read answered; a watcher that cannot read must end. */
    private volatile long lastAnswerAt = System.currentTimeMillis();

    @Override
    public void onCreate() {
        super.onCreate();
        // Notification ids must survive this process: a restarted watcher has
        // to cancel the tray notifications the dead one left behind.
        TurnNotificationIds.bind(this);
        active = this;
        TurnNotificationChannels.create(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_DECIDE.equals(intent.getAction())) {
            decide(intent);
            return START_NOT_STICKY;
        }
        completed = false;
        stopping = false;
        lastAnswerAt = System.currentTimeMillis();
        // A start from the open chat seeds one pane; discovery adds the rest
        // and replaces this row with the kernel's own labels when it answers.
        String nextBase = extra(intent, EXTRA_BASE);
        if (!nextBase.isEmpty()) {
            String runtime = extra(intent, EXTRA_RUNTIME);
            if (runtime.isEmpty()) runtime = nextBase;
            String title = extra(intent, EXTRA_TITLE);
            String root = extra(intent, EXTRA_ROOT);
            PaneWatch watch = watches.get(runtime);
            if (watch == null) {
                watches.put(runtime, new PaneWatch(runtime, runtime, nextBase, root, title, "", "", false));
            } else {
                watch.update(nextBase, root, title);
            }
        }
        try {
            Notification notification = TurnNotifications.running(this, watches.values(), pollFailures >= OFFLINE_AFTER);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(RUNNING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(RUNNING_ID, notification);
            }
        } catch (RuntimeException e) {
            // Android 12+ can refuse a foreground start from the background.
            // The turn itself is unaffected; only the notification is lost.
            Log.w(TAG, "cannot enter the foreground", e);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        acquireWakeLock();
        acquireWifiLock();
        startWatching();
        return START_NOT_STICKY;
    }
    @Override
    public void onDestroy() {
        // A poll already in flight must not re-post notifications after
        // stopForeground has removed them.
        stopping = true;
        stopWatching();
        TurnNotifications.cancelAsks(this, watches.values());
        clearCounts();
        decisions.shutdownNow();
        releaseWakeLock();
        releaseWifiLock();
        if (active == this) active = null;
        try {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } catch (RuntimeException ignored) {
            // already gone
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static String extra(Intent intent, String key) {
        if (intent == null) return "";
        String value = intent.getStringExtra(key);
        return value == null ? "" : value.trim();
    }


    private synchronized void startWatching() {
        if (watcher == null) {
            watcher = Executors.newSingleThreadScheduledExecutor();
            watcher.scheduleWithFixedDelay(() -> {
                try {
                    pollAll();
                } catch (Exception e) {
                    // A poll that failed is not an answer; keep the last state.
                    Log.w(TAG, "watch poll failed", e);
                }
            }, 500, WATCH_POLL_MS, TimeUnit.MILLISECONDS);
        }
        if (peerWatcher == null) {
            peerWatcher = Executors.newSingleThreadScheduledExecutor();
            peerWatcher.scheduleWithFixedDelay(() -> {
                try {
                    pollPeers();
                } catch (Exception e) {
                    peerSweeping = false;
                    Log.w(TAG, "peer poll failed", e);
                }
            }, 3000, 15_000, TimeUnit.MILLISECONDS);
        }
    }

    private synchronized void stopWatching() {
        ScheduledExecutorService current = watcher;
        watcher = null;
        if (current != null) current.shutdownNow();
        ScheduledExecutorService peers = peerWatcher;
        peerWatcher = null;
        if (peers != null) peers.shutdownNow();
    }

    /**
     * Discover the panes on the active computer and read each one.
     *
     * `/runtimes` is authoritative when it answers: a pane that disappeared is
     * finished (and its ask cleared). When it cannot answer, the panes already
     * known are still polled, so an open chat's notification survives a list
     * read failure.
     */
    private void pollAll() {
        if (stopping) return;
        renewWakeLock();
        activeStatusFailed = false;
        boolean listed = false;
        boolean answered = false;
        HttpURLConnection connection = null;
        try {
            connection = open("/runtimes");
            if (connection.getResponseCode() == 200) {
                String body;
                try (InputStream input = connection.getInputStream()) {
                    body = readText(input);
                }
                List<RuntimeList.Row> rows = RuntimeList.parse(body);
                if (rows != null) {
                    listed = true;
                    Set<String> seen = new HashSet<>();
                    for (RuntimeList.Row row : rows) {
                        seen.add(row.id);
                        PaneWatch watch = watches.get(row.id);
                        if (watch == null) {
                            watches.put(row.id, new PaneWatch(row.id, row.id, row.base, row.root, row.title, "", "", row.readOnly));
                            watch = watches.get(row.id);
                        } else {
                            watch.update(row.base, row.root, row.title);
                        }
                        watch.readOnly = row.readOnly;
                        pollStatus(watch, false);
                    }
                    for (String id : new ArrayList<>(watches.keySet())) {
                        if (seen.contains(id)) continue;
                        PaneWatch gone = watches.remove(id);
                        if (gone != null) finishWatch(gone);
                    }
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "runtime list skipped", e);
        } finally {
            if (connection != null) connection.disconnect();
        }
        if (!listed) {
            for (PaneWatch watch : new ArrayList<>(watches.values())) answered |= pollStatus(watch, false);
        }
        if (listed || answered) lastAnswerAt = System.currentTimeMillis();
        notePoll(listed);
        if (System.currentTimeMillis() - lastAnswerAt > QUIET_STOP_MS) {
            stopSelf();
            return;
        }

        boolean active = false;
        for (PaneWatch watch : watches.values()) {
            if (watch.running || watch.waiting) {
                active = true;
                break;
            }
        }
        if (listed && !active && !activeStatusFailed && !peerStatusFailed && !peerSweeping) {
            if (++idlePolls >= 2) {
                stopSelf();
                return;
            }
        } else {
            idlePolls = 0;
        }
        refreshRunning();
    }

    /** Rebuild the next ask after the phone-local display choice changes. */
    static void notificationOptionsChanged() {
        TurnService service = active;
        if (service == null) return;
        for (PaneWatch watch : service.watches.values()) watch.askSignature = "";
        service.mainHandler.post(service::refreshRunning);
    }

    /**
     * Apply a change to which notifications are posted, or how.
     *
     * Only the surfaces the change can affect are touched. Cancelling every ask
     * on any change would drop a question that is on screen because someone
     * toggled「会话完成」, and the phone would show the notification vanish and
     * come back — the switches are independent, so the repairs are too.
     *
     * `done` needs no repair at all: it describes turns that already finished,
     * and the switch is about the next one.
     */
    static void notificationPrefsChanged(boolean askTouched) {
        TurnService service = active;
        if (service == null) return;
        // The ongoing notification is already on screen and has no poll to wait
        // for, so it is rebuilt here; only the channel it posts on changes.
        service.mainHandler.post(service::refreshRunning);
        if (!askTouched) return;
        // Everything that can touch an ask runs as one UI-thread task: the
        // cancel and the signature reset have to land together, or a poll
        // running at the same moment compares against a signature that is
        // about to be cleared and skips the prompt.
        service.mainHandler.post(service::dropAsksForResync);
    }

    /**
     * Drop the asks a changed switch invalidated.
     *
     * Nothing is re-posted from here. The next poll already knows how to post
     * an ask on the channel the switches now name — it compares the status
     * signature, which cancelling clears, so the prompt comes back as new.
     * That costs at most one poll interval (5s), and the alternative was
     * worse: an eager `pollAll` counts idle sweeps and stops the service after
     * two of them, so nudging it on every switch flip could end the background
     * watcher mid-visit to settings — turning a preference change into lost ask
     * and done notifications. It also ran a socket request off the cadence.
     *
     * `cancelAsks` iterates a copy rather than the map, which is why the switches
     * reuse it instead of walking `watches` here: a poll can add or drop an
     * entry while this runs on the UI thread.
     */
    private void dropAsksForResync() {
        if (stopping) return;
        TurnNotifications.cancelAsks(this, watches.values());
    }

    /** The one place a status becomes notification state. */
    private void applyStatus(PaneWatch watch, AskStatus status) {
        boolean wasRunning = watch.running;
        watch.running = status.running;
        watch.waiting = !status.empty() && !watch.readOnly;
        TurnNotifications.syncAsk(this, watch, status, stopping);
        if (wasRunning && !status.running && !MainActivity.visible) {
            TurnNotifications.finished(this, watch);
        }
    }

    /**
     * The other watchable LAN computers, on their own slower cadence.
     *
     * The active computer is in the fleet list too; it is skipped by comparing
     * its target with the proxy's own origin, because /runtimes already
     * watches that one directly. A peer read must not delay the active poll,
     * so this runs on its own thread.
     */
    private boolean pollPeers() {
        if (stopping) return false;
        // Hold the idle stop for the whole sweep; only a clean pass releases it.
        peerSweeping = true;
        peerStatusFailed = false;
        boolean answered = false;
        String activeTarget = "";
        HttpURLConnection config = null;
        try {
            config = open("/__reasonix/config");
            if (config.getResponseCode() == 200) {
                String body;
                try (InputStream input = config.getInputStream()) {
                    body = readText(input);
                }
                activeTarget = new JSONObject(body).optString("origin", "").trim();
                answered = true;
            }
        } catch (Exception e) {
            peerStatusFailed = true;
            Log.d(TAG, "peer config skipped", e);
        } finally {
            if (config != null) config.disconnect();
        }
        List<FleetPeers.Peer> peers = null;
        HttpURLConnection list = null;
        try {
            list = open("/__reasonix/fleet");
            if (list.getResponseCode() == 200) {
                String body;
                try (InputStream input = list.getInputStream()) {
                    body = readText(input);
                }
                peers = FleetPeers.parse(body);
                if (peers != null) answered = true;
            }
        } catch (Exception e) {
            Log.d(TAG, "peer list skipped", e);
        } finally {
            if (list != null) list.disconnect();
        }
        if (peers == null) {
            peerStatusFailed = true;
            peerSweeping = false;
            return answered;
        }
        Set<String> live = new HashSet<>();
        for (FleetPeers.Peer peer : peers) {
            if (!activeTarget.isEmpty() && peer.target.equalsIgnoreCase(activeTarget)) continue;
            live.add(peer.target);
            boolean read = pollPeer(peer);
            answered |= read;
            if (!read) peerStatusFailed = true;
        }
        // A peer that left the list, or became the active computer, must not
        // keep an ask or a stale running state.
        for (PaneWatch watch : new ArrayList<>(watches.values())) {
            if (watch.peer.isEmpty() || live.contains(watch.peer)) continue;
            watches.remove(watch.key);
            finishWatch(watch);
        }
        if (answered) lastAnswerAt = System.currentTimeMillis();
        peerSweeping = false;
        return answered;
    }

    /** One peer's runtimes, then the status of each. */
    private boolean pollPeer(FleetPeers.Peer peer) {
        boolean answered = false;
        HttpURLConnection connection = null;
        try {
            connection = open("/__reasonix/fleet/" + peer.index + "/runtimes");
            if (connection.getResponseCode() != 200) return false;
            String body;
            try (InputStream input = connection.getInputStream()) {
                body = readText(input);
            }
            List<RuntimeList.Row> rows = RuntimeList.parse(body);
            if (rows == null) return false;
            answered = true;
            Set<String> keys = new HashSet<>();
            String prefix = "/__reasonix/fleet/" + peer.index;
            for (RuntimeList.Row row : rows) {
                String key = "p:" + peer.target + ":" + row.id;
                keys.add(key);
                String base = prefix + (row.base.startsWith("/") ? row.base : "/" + row.base);
                PaneWatch watch = watches.get(key);
                if (watch == null) {
                    watches.put(key, new PaneWatch(row.id, key, base, row.root, row.title, peer.target, peer.name, row.readOnly));
                    watch = watches.get(key);
                } else {
                    watch.update(base, row.root, row.title);
                }
                watch.readOnly = row.readOnly;
                answered |= pollStatus(watch, true);
            }
            for (PaneWatch watch : new ArrayList<>(watches.values())) {
                if (!watch.peer.equals(peer.target) || keys.contains(watch.key)) continue;
                watches.remove(watch.key);
                finishWatch(watch);
            }
        } catch (Exception e) {
            Log.d(TAG, "peer poll skipped", e);
        } finally {
            if (connection != null) connection.disconnect();
        }
        return answered;
    }

    /** One pane's status: asks and completion live here. */
    private boolean pollStatus(PaneWatch watch, boolean peer) {
        if (stopping) return false;
        String prefix = watch.base;
        if (prefix.isEmpty()) {
            markStatusFailed(peer);
            return false;
        }
        HttpURLConnection connection = null;
        try {
            connection = open(prefix + "/status");
            if (connection.getResponseCode() != 200) {
                markStatusFailed(peer);
                return false;
            }
            String body;
            try (InputStream input = connection.getInputStream()) {
                body = readText(input);
            }
            AskStatus status = AskStatus.parse(body);
            applyStatus(watch, status);
            return true;
        } catch (Exception e) {
            // The next tick tries again; a dead pane must not kill the rest.
            Log.d(TAG, "status poll skipped", e);
            markStatusFailed(peer);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void markStatusFailed(boolean peer) {
        if (peer) peerStatusFailed = true;
        else activeStatusFailed = true;
    }

    private HttpURLConnection open(String path) throws IOException {
        URI uri = URI.create("http://127.0.0.1:" + LoopbackProxy.PORT + path);
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(3000);
        connection.setRequestProperty("Cookie", LoopbackProxy.authCookie(this));
        return connection;
    }

    private void notePoll(boolean answered) {
        if (stopping) return;
        if (answered) {
            pollFailures = 0;
        } else if (pollFailures < OFFLINE_AFTER) {
            pollFailures += 1;
        }
    }

    private void refreshRunning() {
        if (stopping) return;
        rememberCounts();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(RUNNING_ID, TurnNotifications.running(this, watches.values(), pollFailures >= OFFLINE_AFTER));
        } catch (RuntimeException e) {
            // A permission revoked mid-turn must not stop the watcher.
            Log.w(TAG, "cannot refresh the running notification", e);
        }
    }

    /** Keep the Quick Settings tile's counts in step with this summary. */
    private void rememberCounts() {
        int running = 0;
        int waiting = 0;
        for (PaneWatch watch : watches.values()) {
            if (watch.running) running++;
            if (watch.waiting) waiting++;
        }
        getSharedPreferences(ReasonixTileService.PREFS, MODE_PRIVATE)
                .edit()
                .putInt(ReasonixTileService.KEY_RUNNING, running)
                .putInt(ReasonixTileService.KEY_WAITING, waiting)
                .apply();
        ReasonixTileService.requestRefresh(this);
    }

    private void clearCounts() {
        getSharedPreferences(ReasonixTileService.PREFS, MODE_PRIVATE)
                .edit()
                .putInt(ReasonixTileService.KEY_RUNNING, 0)
                .putInt(ReasonixTileService.KEY_WAITING, 0)
                .apply();
        ReasonixTileService.requestRefresh(this);
    }

    private static String readText(InputStream input) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (out.size() + read > MAX_BODY) break;
            out.write(buffer, 0, read);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }


    /**
     * Settle the decision an action named.
     *
     * LAN goes straight through the proxy. Cloud has no upstream there — the
     * relay lives in the WebView — so the same POST is handed to the page's
     * bridge, and the next sweep reflects it.
     */
    private void decide(Intent intent) {
        String runtime = extra(intent, EXTRA_RUNTIME);
        PaneWatch watch = watches.get(runtime);
        if (watch == null) {
            // An intent from an older build carries the bare runtime id, and
            // local keys are runtime ids, so scan before giving up.
            watch = findByRuntime(runtime);
        }
        if (watch == null) {
            // A notification outlives the service: a tap after process death
            // arrives at an empty map. The tap must not die silently — the
            // ask card read fresh from the kernel can still be answered in
            // the chat, so open the conversation the key names.
            openChatFallback(runtime);
            return;
        }
        if (watch.base.isEmpty()) return;
        // The executor's lambda needs a final name: `watch` was reassigned on
        // the lookup paths above.
        PaneWatch settled = watch;
        String decisionId = extra(intent, EXTRA_DECISION);
        if (decisionId.isEmpty()) return;
        boolean approval = intent.getBooleanExtra(EXTRA_APPROVAL, false);
        try {
            JSONObject body = new JSONObject();
            String path;
            if (approval) {
                body.put("id", decisionId);
                body.put("allow", intent.getBooleanExtra(EXTRA_ALLOW, false));
                body.put("session", intent.getBooleanExtra(EXTRA_SESSION, false));
                body.put("persist", false);
                path = settled.base + "/approve";
            } else {
                JSONObject answer = new JSONObject();
                answer.put("QuestionID", extra(intent, EXTRA_QUESTION));
                answer.put("Selected", new JSONArray().put(extra(intent, EXTRA_SELECTED)));
                body.put("id", decisionId);
                body.put("answers", new JSONArray().put(answer));
                path = settled.base + "/answer";
            }
            decisions.execute(() -> {
                if (post(path, body)) {
                    pollStatus(settled, false);
                    mainHandler.post(this::refreshRunning);
                }
            });
        } catch (Exception e) {
            Log.d(TAG, "decision skipped", e);
        }
    }

    /** A watch whose key is not the map key the intent named (older builds). */
    private PaneWatch findByRuntime(String runtime) {
        if (runtime.isEmpty()) return null;
        PaneWatch local = null;
        for (PaneWatch candidate : watches.values()) {
            if (!candidate.runtime.equals(runtime)) continue;
            // This computer's own pane wins over a same-id pane on a peer.
            if (candidate.peer.isEmpty()) return candidate;
            local = candidate;
        }
        return local;
    }

    /**
     * A decision the service can no longer settle: rebuild the conversation
     * link from the key the intent carries and let the ask card be answered
     * there. Peer keys parse back into their target and row id; a bare
     * runtime id from an older build opens this computer's pane. The split
     * takes the last colon because the target is a full origin and carries
     * colons of its own (scheme, port); a runtime id never does.
     */
    private void openChatFallback(String key) {
        String peer = "";
        String id = key;
        if (key.startsWith("p:")) {
            int at = key.lastIndexOf(':');
            if (at > 2) {
                peer = key.substring(2, at);
                id = key.substring(at + 1);
            }
        }
        if (id.isEmpty()) return;
        StringBuilder link = new StringBuilder("reasonix://chat?runtime=").append(Uri.encode(id));
        if (!peer.isEmpty()) link.append("&peer=").append(Uri.encode(peer));
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link.toString()), this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        // Stop only when nothing else is watched: a tray notification left by
        // a previous process can name a pane that no longer exists, and
        // stopping the warm foreground service over it would cancel every
        // live pane's ask with it.
        if (watches.isEmpty()) stopSelf();
    }

    private boolean post(String path, JSONObject body) {
        HttpURLConnection connection = null;
        try {
            connection = open(path);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            // Name the app's own page: the proxy still refuses a foreign
            // Origin before routing a write.
            connection.setRequestProperty("Origin", "http://127.0.0.1:" + LoopbackProxy.PORT);
            connection.setRequestProperty("Referer", "http://127.0.0.1:" + LoopbackProxy.PORT + "/");
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(data.length);
            try (java.io.OutputStream out = connection.getOutputStream()) {
                out.write(data);
            }
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }


    /** A pane that left the list: finish its ask and announce its last turn. */
    private void finishWatch(PaneWatch watch) {
        if (watch.running && !MainActivity.visible) TurnNotifications.finished(this, watch);
        TurnNotifications.cancelAsk(this, watch);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power == null) return;
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "reasonix:turn");
        wakeLock.setReferenceCounted(false);
        // A cap, not an expectation: a forgotten service must not drain the
        // battery for a turn that already ended.
        wakeLock.acquire(WAKE_LOCK_MS);
    }

    private void renewWakeLock() {
        if (wakeLock == null || wakeLock.isHeld()) return;
        try {
            wakeLock.acquire(WAKE_LOCK_MS);
        } catch (RuntimeException e) {
            Log.w(TAG, "cannot renew the wake lock", e);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    /**
     * Keep the radio awake as well as the CPU.
     *
     * The kernel is on a LAN or across the internet; with Wi-Fi asleep the
     * poll fails until the phone wakes, which is exactly when the screen is
     * off. The lock covers Wi-Fi only — a cellular link is governed by the
     * system's data policy, which the battery-optimization setting addresses.
     */
    @SuppressWarnings("deprecation")
    private void acquireWifiLock() {
        if (wifiLock != null && wifiLock.isHeld()) return;
        try {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wifi == null) return;
            int lockMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wifi.createWifiLock(lockMode, "reasonix:turn-wifi");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (RuntimeException e) {
            // A device that refuses the lock still runs the turn; only its
            // background polling is less reliable.
            Log.w(TAG, "cannot hold a Wi-Fi lock", e);
            wifiLock = null;
        }
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException ignored) {
            // already released
        }
        wifiLock = null;
    }


}
