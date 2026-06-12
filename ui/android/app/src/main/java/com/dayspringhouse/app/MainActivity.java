package com.dayspringhouse.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Enable Chrome remote debugging: chrome://inspect in desktop Chrome
        WebView.setWebContentsDebuggingEnabled(true);
    }
}
