package com.colorbrawl.android

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Color Brawl — the Android host for the INKWAVE web game.
 *
 * The entire game (HTML / CSS / ES modules / three.js / assets) is packaged inside the APK under
 * `assets/game/` and served to the WebView through [WebViewAssetLoader] on
 * `https://appassets.androidplatform.net/`. A real https origin is required: ES modules,
 * `fetch()`, `TextureLoader` and `import.meta.url` all fail from a `file://` origin.
 *
 * No game logic lives here. This activity owns the WebView, the immersive window, the
 * lifecycle, and the Android<->JS bridge.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "ColorBrawl"
        private const val ASSET_DOMAIN = "appassets.androidplatform.net"
        private const val ENTRY_URL = "https://$ASSET_DOMAIN/game/index.html"
    }

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private var pageFinished = false

    /** Reported by the page every frame: true while the game is showing a dismissible screen. */
    @Volatile
    private var pageConsumesBack = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the screen awake during play; the game has no idle state.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#0D1020"))
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        WebView.setWebContentsDebuggingEnabled(true)

        configureWebView()
        applyImmersiveMode()

        // Android back button. The page tells us (through the bridge) whether it is showing a
        // screen that back should dismiss. No synchronous JS evaluation is involved.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (pageConsumesBack) {
                    webView.evaluateJavascript(
                        "window.__colorbrawl && window.__colorbrawl.onBackPressed && window.__colorbrawl.onBackPressed()",
                        null
                    )
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            val url = ENTRY_URL + gameQuery(intent)
            Log.i(TAG, "loading $url")
            webView.loadUrl(url)
        }
    }

    /**
     * Builds the query string appended to the entry URL.
     *
     * The site's own parameters (`?autostart=`, `?mode=`, `?difficulty=`, `?map=`,
     * `?skipTitle`, `?autopilot`, …) cannot be delivered with `am start -d <url>`: on a
     * device that URL is handed to the default browser instead of this activity. They are
     * passed as intent extras instead and appended here. The values are URL-encoded so a
     * caller cannot inject additional parameters through them.
     */
    private fun gameQuery(intent: android.content.Intent?): String {
        val i = intent ?: return ""
        val parts = mutableListOf<String>()
        for (key in arrayOf("autostart", "mode", "difficulty", "map", "time", "relay")) {
            val v = i.getStringExtra("cb_$key") ?: continue
            parts += "$key=" + java.net.URLEncoder.encode(v, "UTF-8")
        }
        for (key in arrayOf("skipTitle", "autopilot", "netmock", "mttest")) {
            if (i.getBooleanExtra("cb_$key", false)) parts += "$key=1"
        }
        return if (parts.isEmpty()) "" else "?" + parts.joinToString("&")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        // AssetsPathHandler strips any registered prefix before handing the remainder to
        // AssetManager, so registering "/game/" would make it look for `assets/index.html`.
        // Registering at the root keeps the full path, which maps 1:1 onto the APK:
        //   https://appassets.androidplatform.net/game/index.html
        //     -> assets/game/index.html
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            // A user gesture is still required before audio starts — that gesture is the first
            // tap on the page, which the game already listens for.
            mediaPlaybackRequiresUserGesture = true
            useWideViewPort = true
            loadWithOverviewMode = false
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = false
            }
        }
        webView.isHorizontalScrollBarEnabled = false
        webView.isVerticalScrollBarEnabled = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.setBackgroundColor(Color.parseColor("#0D1020"))

        // The touch layer must be installed before the game's own module script runs.
        webView.addJavascriptInterface(GameBridge(), "ColorBrawl")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                pageFinished = false
                // Every navigation is logged: an unexpected reload destroys the page's JS
                // context (including the game's window.G) and re-arms the touch layer, which
                // is invisible without this line.
                Log.i(TAG, "onPageStarted: $url")
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                Log.i(TAG, "history update: $url reload=$isReload")
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: android.webkit.RenderProcessGoneDetail
            ): Boolean {
                // The WebView renderer died (usually OOM). Without this the activity is left
                // holding a dead WebView and simply goes blank. Recreate it instead.
                Log.e(
                    TAG,
                    "WEBVIEW RENDERER GONE: crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}"
                )
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                pageFinished = true
                Log.i(TAG, "onPageFinished: $url")
                installTouchController()
                applyImmersiveMode()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error.description else "?"
                Log.e(TAG, "webview resource error: ${request.url} main=${request.isForMainFrame} :: $desc")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val tag = "CB/" + msg.messageLevel().name
                val line = "${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})"
                when (msg.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.e(TAG, "$tag $line")
                    ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, "$tag $line")
                    else -> Log.i(TAG, "$tag $line")
                }
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                Log.w(TAG, "denying permission request: ${request.resources.joinToString()}")
                request.deny()
            }
        }
    }

    /**
     * Installs the Android touch input layer. Runs at document-idle for every page load, so a
     * reload or a restored state gets it too. The script is a plain (non-module) file placed in
     * `assets/game/android/`, fetchable because the page origin is the asset-loader origin.
     */
    private fun installTouchController() {
        val js = """
            (function () {
              if (window.__cbTouchInstalling) return;
              window.__cbTouchInstalling = true;
              var s = document.createElement('script');
              s.src = '/game/android/touch.js';
              s.onerror = function () {
                window.ColorBrawl && window.ColorBrawl.log('error', 'touch.js failed to load');
              };
              (document.head || document.documentElement).appendChild(s);
              var e = document.createElement('script');
              e.src = '/game/android/errorhook.js';
              (document.head || document.documentElement).appendChild(e);
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        // Freeze the game loop and release audio while backgrounded.
        if (pageFinished) {
            webView.evaluateJavascript(
                "window.__colorbrawl && window.__colorbrawl.onHostPause && window.__colorbrawl.onHostPause()",
                null
            )
        }
        webView.onPause()
        webView.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        webView.onResume()
        if (pageFinished) {
            webView.evaluateJavascript(
                "window.__colorbrawl && window.__colorbrawl.onHostResume && window.__colorbrawl.onHostResume()",
                null
            )
        }
        applyImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyImmersiveMode()
    }

    private fun applyImmersiveMode() {
        val controller = WindowInsetsControllerCompat(window, root)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    /** Minimal, purpose-built bridge. Exposed to JS as `window.ColorBrawl`. */
    inner class GameBridge {
        @android.webkit.JavascriptInterface
        fun log(level: String, message: String) {
            when (level) {
                "error" -> Log.e(TAG, "JS $message")
                "warn" -> Log.w(TAG, "JS $message")
                else -> Log.i(TAG, "JS $message")
            }
        }

        /** The page reports whether it currently wants to consume the back press. */
        @android.webkit.JavascriptInterface
        fun setBackConsumed(consumed: Boolean) {
            pageConsumesBack = consumed
        }

        @android.webkit.JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        @android.webkit.JavascriptInterface
        fun platform(): String = "android"

        @android.webkit.JavascriptInterface
        fun deviceInfo(): String {
            val dm = resources.displayMetrics
            return """{"platform":"android","sdk":${Build.VERSION.SDK_INT},"width":${dm.widthPixels},"height":${dm.heightPixels},"density":${dm.density}}"""
        }
    }
}
