package app.recipestudio.video.plugin

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.util.Base64
import androidx.core.app.NotificationCompat
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

/**
 * M15 Native VideoSink Plugin:
 * - open({name, mime}) -> {handle, path}
 * - write({handle, position, data(base64)}) -> {bytesWritten}
 * - close({handle}) -> {closed}
 * - saveToMovies({handle|path, displayName, mime}) -> {uri} (MediaStore IS_PENDING pattern, deletes cache file)
 * - startForeground({title, text}) / updateForeground({text, progress}) / stopForeground()
 * - freeSpace() -> {bytes}
 * - share({uri}) and openUri({uri}) / open({uri}) intents
 */
@CapacitorPlugin(name = "VideoSink")
class VideoSinkPlugin : Plugin() {

    private val openFiles = ConcurrentHashMap<String, RandomAccessFile>()
    private val filePaths = ConcurrentHashMap<String, File>()
    private val channelId = "recipe_studio_export_channel"
    private val notificationId = 4102

    @PluginMethod
    fun open(call: PluginCall) {
        // If 'uri' is passed, act as openUri intent (M15 open({uri}) overload)
        val uriStr = call.getString("uri")
        if (uriStr != null && call.getString("name") == null) {
            openUri(call)
            return
        }

        val handle = call.getString("handle") ?: call.getString("sessionId") ?: "sink_${UUID.randomUUID()}"
        val fileName = call.getString("name") ?: call.getString("fileName") ?: "recipe-export.mp4"
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
            ret.put("sessionId", handle)
            ret.put("path", targetFile.absolutePath)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("ERR_OPEN_FAILED: Failed to open native video sink: ${e.message}", "ERR_OPEN_FAILED", e)
        }
    }

    @PluginMethod
    fun openSink(call: PluginCall) {
        open(call)
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val handle = call.getString("handle") ?: call.getString("sessionId") ?: "default"
        val base64Data = call.getString("data") ?: run {
            call.reject("ERR_INVALID_DATA: Missing base64 chunk data", "ERR_INVALID_DATA")
            return
        }
        val position = call.getLong("position") ?: call.getLong("offset") ?: -1L
        val raf = openFiles[handle] ?: run {
            call.reject("ERR_HANDLE_NOT_FOUND: No open sink for handle: $handle", "ERR_HANDLE_NOT_FOUND")
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
            call.reject("ERR_WRITE_FAILED: Failed to write chunk: ${e.message}", "ERR_WRITE_FAILED", e)
        }
    }

    @PluginMethod
    fun writeChunk(call: PluginCall) {
        write(call)
    }

    @PluginMethod
    fun close(call: PluginCall) {
        val handle = call.getString("handle") ?: call.getString("sessionId") ?: "default"
        val raf = openFiles.remove(handle)
        try {
            raf?.close()
            val ret = JSObject()
            ret.put("closed", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("ERR_CLOSE_FAILED: ${e.message}", "ERR_CLOSE_FAILED", e)
        }
    }

    @PluginMethod
    fun saveToMovies(call: PluginCall) {
        val handle = call.getString("handle") ?: call.getString("sessionId")
        val explicitPath = call.getString("path")
        val mime = call.getString("mime") ?: call.getString("mimeType") ?: "video/mp4"
        val displayName = call.getString("displayName") ?: "recipe-studio-${System.currentTimeMillis()}.mp4"

        if (handle != null) {
            openFiles.remove(handle)?.close()
        }
        val tempFile = when {
            handle != null && filePaths.containsKey(handle) -> filePaths.remove(handle)
            explicitPath != null -> File(explicitPath)
            else -> null
        }

        if (tempFile == null || !tempFile.exists()) {
            call.reject("ERR_FILE_NOT_FOUND: Export cache file not found", "ERR_FILE_NOT_FOUND")
            return
        }

        try {
            val fileLength = tempFile.length()
            var exportedUriString = tempFile.absolutePath

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                    put(MediaStore.Video.Media.MIME_TYPE, mime)
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
                val moviesDir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),
                    "RecipeStudio"
                )
                if (!moviesDir.exists()) moviesDir.mkdirs()
                val dest = File(moviesDir, displayName)
                FileOutputStream(dest).use { outStream ->
                    tempFile.inputStream().use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                exportedUriString = Uri.fromFile(dest).toString()
            }

            // Delete cache file after copying to Movies/RecipeStudio
            tempFile.delete()

            val ret = JSObject()
            ret.put("uri", exportedUriString)
            ret.put("size", fileLength)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("ERR_SAVE_MOVIES_FAILED: ${e.message}", "ERR_SAVE_MOVIES_FAILED", e)
        }
    }

    @PluginMethod
    fun closeSink(call: PluginCall) {
        saveToMovies(call)
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
            call.reject("ERR_FREE_SPACE_FAILED: ${e.message}", "ERR_FREE_SPACE_FAILED", e)
        }
    }

    @PluginMethod
    fun startForeground(call: PluginCall) {
        val title = call.getString("title") ?: "Recipe Studio Export"
        val text = call.getString("text") ?: "Rendering deterministic frames..."
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    channelId,
                    "Recipe Studio Video Export",
                    NotificationManager.IMPORTANCE_LOW
                )
                nm.createNotificationChannel(channel)
            }
            val notif = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setProgress(100, 0, false)
                .build()
            nm.notify(notificationId, notif)

            val ret = JSObject()
            ret.put("started", true)
            call.resolve(ret)
        } catch (e: Exception) {
            val ret = JSObject()
            ret.put("started", false)
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun updateForeground(call: PluginCall) {
        val text = call.getString("text") ?: "Rendering..."
        val progress = (call.getInt("progress") ?: 0).coerceIn(0, 100)
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notif = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Recipe Studio Export")
                .setContentText(text)
                .setOngoing(true)
                .setProgress(100, progress, false)
                .build()
            nm.notify(notificationId, notif)

            val ret = JSObject()
            ret.put("updated", true)
            call.resolve(ret)
        } catch (e: Exception) {
            val ret = JSObject()
            ret.put("updated", false)
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun stopForeground(call: PluginCall) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(notificationId)
        } catch (_: Exception) {
        }
        val ret = JSObject()
        ret.put("stopped", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val uriStr = call.getString("uri") ?: run {
            call.reject("ERR_MISSING_URI: Missing uri to share", "ERR_MISSING_URI")
            return
        }
        val mime = call.getString("mime") ?: "video/mp4"
        try {
            val uri = Uri.parse(uriStr)
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(shareIntent, "Share Exported Video").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            val ret = JSObject()
            ret.put("shared", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("ERR_SHARE_FAILED: ${e.message}", "ERR_SHARE_FAILED", e)
        }
    }

    @PluginMethod
    fun openUri(call: PluginCall) {
        val uriStr = call.getString("uri") ?: run {
            call.reject("ERR_MISSING_URI: Missing uri to open", "ERR_MISSING_URI")
            return
        }
        val mime = call.getString("mime") ?: "video/mp4"
        try {
            val uri = Uri.parse(uriStr)
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(viewIntent)
            val ret = JSObject()
            ret.put("opened", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("ERR_OPEN_URI_FAILED: ${e.message}", "ERR_OPEN_URI_FAILED", e)
        }
    }
}
