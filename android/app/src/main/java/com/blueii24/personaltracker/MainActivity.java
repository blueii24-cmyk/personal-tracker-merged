package com.blueii24.personaltracker;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate().
        registerPlugin(SecureKeyPlugin.class);
        // Draw behind the system bars; the web layer pads itself with the insets Capacitor reports.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
