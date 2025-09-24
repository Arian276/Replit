package com.barriletecosmicotv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.runtime.remember
import androidx.compose.runtime.DisposableEffect
import androidx.media3.exoplayer.ExoPlayer
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.barriletecosmicotv.components.VideoPlayerUnified
import com.barriletecosmicotv.ui.theme.BarrileteCosmicTVTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class VideoPlayerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Pantalla completa REAL - ocultar todo
        hideSystemUI()
        
        val streamUrl = intent.getStringExtra("STREAM_URL") ?: ""
        val streamTitle = intent.getStringExtra("STREAM_TITLE") ?: "Stream"
        val streamId = intent.getStringExtra("STREAM_ID") ?: ""
        
        setContent {
            BarrileteCosmicTVTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // ExoPlayer para esta actividad
                    val exoPlayer = remember {
                        ExoPlayer.Builder(this@VideoPlayerActivity).build()
                    }
                    
                    // Limpiar al salir
                    DisposableEffect(Unit) {
                        onDispose {
                            exoPlayer.release()
                        }
                    }
                    
                    VideoPlayerUnified(
                        streamUrl = streamUrl,
                        streamTitle = streamTitle,
                        streamId = streamId,
                        isFullscreen = true,
                        onFullscreenToggle = { finish() },
                        onExitFullscreen = { finish() },
                        exoPlayer = exoPlayer, // PARÁMETRO OBLIGATORIO
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }
    
    private fun hideSystemUI() {
        // Mantener pantalla encendida
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // Pantalla completa inmersiva
        WindowCompat.setDecorFitsSystemWindows(window, false)
        
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}