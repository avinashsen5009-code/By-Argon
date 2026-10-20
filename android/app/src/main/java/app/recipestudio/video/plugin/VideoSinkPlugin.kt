package app.recipestudio.video.plugin

import android.content.ContentValues
import android.os.Build
import android.os.Environment
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
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(name = "VideoSink")
class VideoSinkPlugin : Plugin() {

    private val openFiles = ConcurrentHashMap<String, RandomAccessFile>()
    private val filePaths = ConcurrentHashMap<String, File>()

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
        val tempFile = filePaths.remove(sessionId)
        try {
            raf?.close()
            if (tempFile == null || !tempFile.exists()) {
                call.reject("Export file not found for sessionId: $sessionId")
                return
            }

            var exportedUriString = tempFile.absolutePath
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, tempFile.name)
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
                val dest = File(moviesDir, tempFile.name)
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
            call.reject("Failed to close native video sink: ${e.message}", e)
        }
    }
}
