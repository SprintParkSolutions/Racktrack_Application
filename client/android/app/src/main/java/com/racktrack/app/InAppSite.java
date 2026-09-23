package com.racktrack.app;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * Our own full-screen web view, so RackTrack Drift Desk is part of this
 * application rather than a trip out to a website.
 *
 * iOS has had this since the Desk was built; Android never did, so every
 * "Drift Desk" press on a phone fell through to the Capacitor Browser - a
 * Chrome tab with demo.racktrack.ai written across the top. The owner saw
 * exactly that on 23 September 2026, and the rule since 22 September is that
 * nothing in this app sends a person out to a browser.
 *
 * The contract is the iOS one, unchanged, so utils/approvals.js calls one
 * thing on both platforms:
 *
 *   open({ url, title, closeOn: string[] })
 *
 * `closeOn` are the paths that mean "I am finished here": the Desk sends
 * people back with a link to the site root and signs them out to /login, and
 * both have to close this view rather than load the website inside it.
 *
 * Local plugins are not discovered automatically - MainActivity names it
 * before the bridge starts, or the JS side gets "not implemented" at runtime
 * with nothing in the build to explain why.
 */
@CapacitorPlugin(name = "InAppSite")
public class InAppSite extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("A http or https url is required");
            return;
        }
        String title = call.getString("title", "");

        ArrayList<String> closeOn = new ArrayList<>(Arrays.asList("/", "/login"));
        JSArray given = call.getArray("closeOn");
        if (given != null) {
            try {
                ArrayList<String> list = new ArrayList<>();
                for (Object o : given.toList()) if (o != null) list.add(String.valueOf(o));
                if (!list.isEmpty()) closeOn = list;
            } catch (Exception ignored) {
                // A malformed list is not worth refusing the whole open for:
                // the defaults above still close the view on the two paths
                // that matter.
            }
        }

        Intent intent = new Intent(getContext(), InAppSiteActivity.class);
        intent.putExtra(InAppSiteActivity.EXTRA_URL, url);
        intent.putExtra(InAppSiteActivity.EXTRA_TITLE, title);
        intent.putStringArrayListExtra(InAppSiteActivity.EXTRA_CLOSE_ON, closeOn);
        getActivity().startActivity(intent);
        call.resolve();
    }
}
