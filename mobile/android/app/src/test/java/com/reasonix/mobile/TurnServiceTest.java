package com.reasonix.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.content.Intent;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowService;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 30)
public class TurnServiceTest {
    private static Intent startIntent(String base, String runtime) {
        Intent intent = new Intent(RuntimeEnvironment.getApplication(), TurnService.class);
        intent.setAction(TurnService.ACTION_START);
        if (!base.isEmpty()) intent.putExtra(TurnService.EXTRA_BASE, base);
        if (!runtime.isEmpty()) intent.putExtra(TurnService.EXTRA_RUNTIME, runtime);
        return intent;
    }

    @Test
    public void startsOnTheForegroundAndRemovesTheNotificationOnDestroy() {
        ServiceController<TurnService> controller = Robolectric.buildService(
                TurnService.class, startIntent("/rt/demo", "demo"));
        TurnService service = controller.create().startCommand(0, 0).get();
        ShadowService shadow = shadowOf(service);

        assertNotNull(shadow.getLastForegroundNotification());
        assertEquals(4101, shadow.getLastForegroundNotificationId());

        controller.destroy();
        assertTrue(shadow.isForegroundStopped());
        assertTrue(shadow.getNotificationShouldRemoved());
    }

}