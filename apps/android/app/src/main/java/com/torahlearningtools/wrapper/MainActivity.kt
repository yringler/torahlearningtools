package com.torahlearningtools.wrapper

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Shows one of the torahlearningtools web apps full screen in an in-app WebView.
 *
 * Why a WebView and not a Trusted Web Activity: a TWA (like an installed Chrome web app) runs inside
 * Chrome, so Android - and Family Link's per-app time limits - count it as Chrome. A WebView runs in
 * this app's own process, so the app gets its own limit and stays usable when Chrome is locked.
 *
 * The page is loaded live from the site (not bundled), so a normal Cloudflare deploy updates the app
 * without a Play release. The site's service worker keeps it working offline after the first launch.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var offlineView: View
    private lateinit var backCallback: OnBackPressedCallback

    private val startUri: Uri = BuildConfig.START_URL.toUri()

    /** Only pages on the app's own https origin load inside the app; everything else goes to other apps. */
    private fun isOwnPage(uri: Uri): Boolean = uri.scheme == "https" && uri.host == startUri.host

    /**
     * The privacy policy and account-deletion pages on the main site also open inside the app, so they
     * stay readable when Chrome is locked. The back button returns to the app.
     */
    private fun isLegalPage(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == "torahlearningtools.com" &&
            uri.path?.trimEnd('/') in setOf("/privacy", "/privacy.html", "/delete-account", "/delete-account.html")

    override fun onCreate(savedInstanceState: Bundle?) {
        // Both web apps have light backgrounds, so always use dark status/navigation bar icons.
        val lightBars = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = lightBars, navigationBarStyle = lightBars)
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val background = ContextCompat.getColor(this, R.color.app_background)
        val root = FrameLayout(this).apply { setBackgroundColor(background) }
        webView = WebView(this).apply { setBackgroundColor(background) }
        offlineView = buildOfflineView(background)
        root.addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(offlineView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)

        // Edge-to-edge is forced from targetSdk 35: keep the page out from under the system bars,
        // and shrink it above the on-screen keyboard so typed answers / the sign-in code stay visible.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        // Back goes back in the page's history; at the first page it leaves the app as usual.
        // (From targetSdk 36 onBackPressed() is no longer called, so this must use the dispatcher.)
        backCallback = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() = webView.goBack()
        }
        onBackPressedDispatcher.addCallback(this, backCallback)

        configureWebView()

        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        if (!restored) webView.loadUrl(launchUrl(intent))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            // Both apps keep progress in localStorage; without this it is silently lost.
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            // Lets the web app tell it is running in this wrapper, should it ever need to.
            userAgentString = "$userAgentString TorahLearningToolsAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (isOwnPage(request.url) || isLegalPage(request.url)) return false
                openElsewhere(request.url)
                return true
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                backCallback.isEnabled = view.canGoBack()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                backCallback.isEnabled = view.canGoBack()
            }

            // Only reached when the service worker can't answer either, i.e. offline before the
            // app was ever opened online (or the site is down).
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) offlineView.visibility = View.VISIBLE
            }
        }
    }

    /** The URL to open: an https link to this app's own site (e.g. baalpeh's sign-in link), or the start page. */
    private fun launchUrl(intent: Intent?): String {
        val data = intent?.data
        return if (data != null && isOwnPage(data)) data.toString() else BuildConfig.START_URL
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data ?: return
        if (isOwnPage(data)) {
            offlineView.visibility = View.GONE
            webView.loadUrl(data.toString())
        }
    }

    /** Other sites, mailto: links etc. Note other sites open in the browser, which may be the locked Chrome. */
    private fun openElsewhere(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            // Nothing can open it; ignore rather than crash.
        }
    }

    private fun buildOfflineView(background: Int): View {
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(background)
            setPadding(dp(24f), dp(24f), dp(24f), dp(24f))
            visibility = View.GONE
            isClickable = true // don't let taps fall through to the WebView underneath
            addView(TextView(context).apply {
                setText(R.string.offline_message)
                gravity = Gravity.CENTER
                setTextColor(Color.BLACK)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
            addView(Button(context).apply {
                setText(R.string.offline_retry)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                setOnClickListener {
                    offlineView.visibility = View.GONE
                    val current = webView.url
                    if (current == null || current == "about:blank") webView.loadUrl(BuildConfig.START_URL) else webView.reload()
                }
            }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(24f) })
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        // Write the sign-in cookie to disk now; the process may be killed in the background.
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
