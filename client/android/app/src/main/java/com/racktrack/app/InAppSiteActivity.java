package com.racktrack.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import java.util.ArrayList;
import java.util.List;

/**
 * The page itself: its name, a Close button, and no address anywhere.
 *
 * The Capacitor Browser this replaces is a Chrome tab - it writes
 * demo.racktrack.ai across the top, which tells a person they have left the
 * app, and they have. This does not: the bar says what they are looking at
 * ("RackTrack Drift Desk") and offers one way out.
 *
 * Cookies are on and persisted, because the hand-over link in
 * utils/approvals.js sets the browser session and then forwards to the page.
 * Without them a person who signed in a minute ago is asked to sign in again.
 */
public class InAppSiteActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_CLOSE_ON = "closeOn";

    private WebView web;
    private List<String> closeOn = new ArrayList<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        String url = getIntent().getStringExtra(EXTRA_URL);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        ArrayList<String> given = getIntent().getStringArrayListExtra(EXTRA_CLOSE_ON);
        if (given != null) closeOn = given;
        if (url == null) { finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        // ── the bar: what this is, and the way out ──
        FrameLayout bar = new FrameLayout(this);
        bar.setBackgroundColor(Color.WHITE);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        bar.setPadding(pad, pad, pad, pad);

        TextView name = new TextView(this);
        name.setText(title == null ? "" : title);
        name.setTextColor(Color.parseColor("#121212"));
        name.setTextSize(16);
        name.setSingleLine(true);
        FrameLayout.LayoutParams nameAt =
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                                         ViewGroup.LayoutParams.WRAP_CONTENT);
        nameAt.gravity = Gravity.CENTER_VERTICAL | Gravity.START;
        bar.addView(name, nameAt);

        TextView close = new TextView(this);
        close.setText("Close");
        close.setTextColor(Color.parseColor("#2349C4"));
        close.setTextSize(15);
        close.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams closeAt =
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                                         ViewGroup.LayoutParams.WRAP_CONTENT);
        closeAt.gravity = Gravity.CENTER_VERTICAL | Gravity.END;
        bar.addView(close, closeAt);

        root.addView(bar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        View hairline = new View(this);
        hairline.setBackgroundColor(Color.parseColor("#E8E9ED"));
        root.addView(hairline, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1,
                (int) getResources().getDisplayMetrics().density)));

        final ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);

        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setLoadWithOverviewMode(true);
        web.getSettings().setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        FrameLayout stage = new FrameLayout(this);
        stage.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams spinAt =
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                                         ViewGroup.LayoutParams.WRAP_CONTENT);
        spinAt.gravity = Gravity.CENTER;
        stage.addView(spinner, spinAt);
        root.addView(stage, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // "I am finished here": the Desk sends people back to the site
                // root and signs them out to /login. Either one closes this
                // view rather than loading the website inside it.
                Uri to = request.getUrl();
                String path = to.getPath() == null ? "/" : to.getPath();
                for (String end : closeOn) {
                    if (path.equals(end)) { finish(); return true; }
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String finished) {
                spinner.setVisibility(View.GONE);
            }
        });

        setContentView(root);
        web.loadUrl(url);

        // Back walks the Desk's own history first, and only leaves when there
        // is nowhere left to go back to.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebViewClient(new WebViewClient());
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(0, android.R.anim.fade_out);
    }
}
