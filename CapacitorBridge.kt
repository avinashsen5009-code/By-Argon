package com.getcapacitor

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

class JSObject : JSONObject() {
    override fun put(name: String, value: Any?): JSObject {
        super.put(name, value)
        return this
    }
    override fun put(name: String, value: Boolean): JSObject {
        super.put(name, value)
        return this
    }
    override fun put(name: String, value: Int): JSObject {
        super.put(name, value)
        return this
    }
    override fun put(name: String, value: Long): JSObject {
        super.put(name, value)
        return this
    }
    override fun put(name: String, value: Double): JSObject {
        super.put(name, value)
        return this
    }
}

class PluginCall(
    private val payload: JSONObject,
    private val onResolve: (JSObject) -> Unit,
    private val onReject: (String) -> Unit
) {
    fun getString(key: String): String? =
        if (payload.has(key) && !payload.isNull(key)) payload.optString(key) else null

    fun getLong(key: String): Long? =
        if (payload.has(key) && !payload.isNull(key)) payload.optLong(key) else null

    fun getInt(key: String): Int? =
        if (payload.has(key) && !payload.isNull(key)) payload.optInt(key) else null

    fun resolve(data: JSObject = JSObject()) {
        onResolve(data)
    }

    fun reject(msg: String, err: Exception? = null) {
        onReject(err?.message?.let { "$msg ($it)" } ?: msg)
    }
}

open class Plugin {
    lateinit var context: Context
    lateinit var activity: AppCompatActivity
}

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class PluginMethod

open class BridgeActivity : AppCompatActivity() {
    private val registeredPlugins = mutableMapOf<String, Plugin>()
    protected lateinit var webView: WebView

    fun registerPlugin(pluginClass: Class<out Plugin>) {
        try {
            val instance = pluginClass.getDeclaredConstructor().newInstance()
            instance.context = this
            instance.activity = this
            val ann = pluginClass.getAnnotation(CapacitorPlugin::class.java)
            val name = ann?.name?.takeIf { it.isNotEmpty() } ?: pluginClass.simpleName
            registeredPlugins[name] = instance
        } catch (_: Exception) {
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.addJavascriptInterface(
            object {
                @JavascriptInterface
                fun invoke(pluginName: String, methodName: String, optionsJson: String): String {
                    val plugin = registeredPlugins[pluginName]
                        ?: return JSONObject().put("error", "Plugin not found: $pluginName").toString()
                    var resultJson = "{}"
                    try {
                        val method = plugin.javaClass.methods.firstOrNull { it.name == methodName }
                            ?: return JSONObject().put("error", "Method not found: $methodName").toString()
                        val payload = if (optionsJson.isBlank()) JSONObject() else JSONObject(optionsJson)
                        val call = PluginCall(
                            payload,
                            onResolve = { res -> resultJson = res.toString() },
                            onReject = { msg -> resultJson = JSONObject().put("error", msg).toString() }
                        )
                        method.invoke(plugin, call)
                    } catch (e: Exception) {
                        resultJson = JSONObject().put("error", e.message ?: "Invocation error").toString()
                    }
                    return resultJson
                }
            },
            "RecipeStudioNativeBridge"
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url
                if (url.host == "localhost") {
                    val path = if (url.path.isNullOrEmpty() || url.path == "/") {
                        "/public/index.html"
                    } else {
                        "/public" + url.path
                    }
                    val rewritten = url.buildUpon().path(path).build()
                    return assetLoader.shouldInterceptRequest(rewritten)
                }
                return super.shouldInterceptRequest(view, request)
            }
        }

        webView.loadUrl("https://localhost/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
