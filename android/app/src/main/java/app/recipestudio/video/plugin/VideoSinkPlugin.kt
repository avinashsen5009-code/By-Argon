package app.recipestudio.video.plugin

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "VideoSink")
class VideoSinkPlugin : Plugin() {

    private val openFiles = ConcurrentHashMap<String, RandomAccessFile>()
    private val filePaths = ConcurrentHashMap<String, File>()

    @PluginMethod
    fun open(call: PluginCall) {
        val handle = UUID.randomUUID().toString()
        val fileName = call.getString("name") ?: "recipe-export.mp4"
        try {
            val outDir = File(context.cacheDir, "exports")
            if (!outDir.exists()) outDir.mkdirs()
            val targetFile = File(outDir, fileName)
            if (targetFile.exists()) targetFile.delete()
            val raf = RandomAccessFile(targetFile, "rw")
            openFiles[handle] = raf
            filePaths[handle] = targetFile

            val ret = JSObject()
            ret.put("handle", handle)
            ret.put("path", targetFile.absolutePath)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to open video sink: ${e.message}", e)
        }
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val handle = call.getString("handle") ?: "default"
        val base64Data = call.getString("data") ?: run {
            call.reject("Missing base64 data")
            return
        }
        val position = call.getLong("position") ?: -1L
        val raf = openFiles[handle] ?: run {
            call.reject("No open handle: $handle")
            return
        }
        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            synchronized(raf) {
                if (position >= 0L) {
                    raf.seek(position)
                } else {
                    raf.seek(raf.length())
                }
                raf.write(bytes)
            }
            val ret = JSObject()
            ret.put("bytesWritten", bytes.size)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to write bytes: ${e.message}", e)
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val handle = call.getString("handle") ?: "default"
        val raf = openFiles.remove(handle)
        try {
            raf?.close()
            val ret = JSObject()
            ret.put("closed", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to close handle: ${e.message}", e)
        }
    }

    @PluginMethod
    fun saveToMovies(call: PluginCall) {
        val handle = call.getString("handle")
        val path = call.getString("path")
        val displayName = call.getString("displayName") ?: "recipe-video.mp4"
        val mimeType = call.getString("mime") ?: "video/mp4"

        val tempFile = (if (handle != null) filePaths.remove(handle) else null)
            ?: (if (path != null) File(path) else null)

        if (tempFile == null || !tempFile.exists()) {
            call.reject("Export file not found")
            return
        }

        try {
            var exportedUriString = tempFile.absolutePath
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                    put(MediaStore.Video.Media.MIME_TYPE, mimeType)
                    put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/RecipeStudio")
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                if (uri != null) {
                    resolver.openOutputStream(uri)?.use { outStream ->
                        tempFile.inputStream().use { inStream ->
                            inStream.copyTo(outStream)
                        }
                    }
                    values.clear()
                    values.put(MediaStore.Video.Media.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    exportedUriString = uri.toString()
                }
            } else {
                val moviesDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "RecipeStudio")
                if (!moviesDir.exists()) moviesDir.mkdirs()
                val dest = File(moviesDir, displayName)
                FileOutputStream(dest).use { outStream ->
                    tempFile.inputStream().use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                exportedUriString = dest.absolutePath
            }

            val ret = JSObject()
            ret.put("uri", exportedUriString)
            ret.put("size", tempFile.length())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to save to Movies: ${e.message}", e)
        }
    }

    @PluginMethod
    fun freeSpace(call: PluginCall) {
        try {
            val stat = StatFs(context.cacheDir.absolutePath)
            val bytes = stat.availableBlocksLong * stat.blockSizeLong
            val ret = JSObject()
            ret.put("bytes", bytes)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to query free space: ${e.message}", e)
        }
    }

    @PluginMethod
    fun startForeground(call: PluginCall) {
        val ret = JSObject().put("started", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun updateForeground(call: PluginCall) {
        val ret = JSObject().put("updated", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopForeground(call: PluginCall) {
        val ret = JSObject().put("stopped", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val uriStr = call.getString("uri") ?: run {
            call.reject("Missing uri")
            return
        }
        val mime = call.getString("mime") ?: "video/mp4"
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, Uri.parse(uriStr))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, "Share Video"))
            call.resolve(JSObject().put("shared", true))
        } catch (e: Exception) {
            call.reject("Failed to share video: ${e.message}", e)
        }
    }

    @PluginMethod
    fun openUri(call: PluginCall) {
        val uriStr = call.getString("uri") ?: run {
            call.reject("Missing uri")
            return
        }
        val mime = call.getString("mime") ?: "video/mp4"
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(uriStr), mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            call.resolve(JSObject().put("opened", true))
        } catch (e: Exception) {
            call.reject("Failed to open video URI: ${e.message}", e)
        }
    }

    // Backwards-compatible aliases
    @PluginMethod
    fun openSink(call: PluginCall) {
        val sessionId = call.getString("sessionId") ?: "default"
        val fileName = call.getString("fileName") ?: "recipe-export.mp4"
        try {
            val outDir = File(context.cacheDir, "exports")
            if (!outDir.exists()) outDir.mkdirs()
            val targetFile = File(outDir, fileName)
            if (targetFile.exists()) targetFile.delete()
            val raf = RandomAccessFile(targetFile, "rw")
            openFiles[sessionId] = raf
            filePaths[sessionId] = targetFile

            val ret = JSObject()
            ret.put("sessionId", sessionId)
            ret.put("path", targetFile.absolutePath)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to open native video sink: ${e.message}", e)
        }
    }

    @PluginMethod
    fun writeChunk(call: PluginCall) {
        val sessionId = call.getString("sessionId") ?: "default"
        val base64Data = call.getString("data") ?: run {
            call.reject("Missing base64 chunk data")
            return
        }
        val offset = call.getLong("offset") ?: -1L
        val raf = openFiles[sessionId] ?: run {
            call.reject("No open sink for sessionId: $sessionId")
            return
        }
        try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            synchronized(raf) {
                if (offset >= 0L) {
                    raf.seek(offset)
                } else {
                    raf.seek(raf.length())
                }
                raf.write(bytes)
            }
            val ret = JSObject()
            ret.put("bytesWritten", bytes.size)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to write chunk: ${e.message}", e)
        }
    }

    @PluginMethod
    fun closeSink(call: PluginCall) {
        val sessionId = call.getString("sessionId") ?: "default"
        val mimeType = call.getString("mimeType") ?: "video/mp4"
        val raf = openFiles.remove(sessionId)
        val tempFile = filePaths[sessionId]
        try {
            raf?.close()
            if (tempFile == null || !tempFile.exists()) {
                call.reject("Export file not found for sessionId: $sessionId")
                return
            }
            val saveCall = PluginCall(
                org.json.JSONObject()
                    .put("handle", sessionId)
                    .put("displayName", tempFile.name)
                    .put("mime", mimeType),
                onResolve = { res -> call.resolve(res) },
                onReject = { msg -> call.reject(msg) }
            )
            saveToMovies(saveCall)
        } catch (e: Exception) {
            call.reject("Failed to close native video sink: ${e.message}", e)
        }
    }
}
