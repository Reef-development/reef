package za.co.reef.operations;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Screens where Back should leave the app; anywhere else it goes back one page in the web app.
    private static final String BACK_SCRIPT =
        "(function(){var p=location.pathname.replace(/\\/+$/,'');"
            + "if(p===''||p==='/worker'||p==='/dashboard'||p==='/auth'){return 'exit';}"
            + "history.back();return 'back';})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                webView.evaluateJavascript(BACK_SCRIPT, result -> {
                    if (result == null || result.contains("exit")) {
                        moveTaskToBack(true);
                    }
                });
            }
        });
    }
}
