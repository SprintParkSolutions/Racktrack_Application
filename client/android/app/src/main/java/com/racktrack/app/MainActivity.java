package com.racktrack.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are not discovered automatically — they have to be
        // named before the bridge starts, or the JS side gets "not implemented"
        // at runtime with nothing in the build to explain why.
        registerPlugin(SnmpUdp.class);
        // Our own full-screen web view. Without it every "Drift Desk" press
        // fell through to the Capacitor Browser - a Chrome tab with the
        // server's address across the top - which is the one thing this app
        // does not do (the owner, 22 and 23 September 2026).
        registerPlugin(InAppSite.class);
        super.onCreate(savedInstanceState);
    }
}
