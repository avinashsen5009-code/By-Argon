package app.recipestudio.video

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import app.recipestudio.video.plugin.VideoSinkPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(VideoSinkPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
