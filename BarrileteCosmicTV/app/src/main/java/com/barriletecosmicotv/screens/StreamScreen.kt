package com.barriletecosmicotv.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import com.barriletecosmicotv.components.VideoPlayerUnified
import com.barriletecosmicotv.components.SuperChatComponent
import androidx.media3.exoplayer.ExoPlayer
import com.barriletecosmicotv.components.ViewerCount
import com.barriletecosmicotv.data.ViewerTracker
import com.barriletecosmicotv.model.Stream
import com.barriletecosmicotv.ui.theme.*
import com.barriletecosmicotv.viewmodel.StreamViewModel
import com.barriletecosmicotv.data.LikesRepository
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlin.random.Random
import javax.inject.Inject

// Chat original restaurado

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StreamScreen(
    streamId: String,
    navController: NavController? = null,
    onBackClick: (() -> Unit)? = null,
    viewModel: StreamViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val stream by viewModel.currentStream.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val viewerCount by viewModel.viewerCount.collectAsState()
    var showDonationModal by remember { mutableStateOf(false) }
    var isFullscreen by remember { mutableStateOf(false) }
    
    // CONTROL DE ROTACIÓN - SOLO en fullscreen del video player
    LaunchedEffect(isFullscreen) {
        activity?.requestedOrientation = if (isFullscreen) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }
    
    // Restaurar rotación y barras del sistema al salir
    DisposableEffect(Unit) {
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            // Restaurar barras del sistema
            activity?.window?.decorView?.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE
        }
    }
    
    // Sistema de likes real - empezando desde 0
    val likesRepository: LikesRepository = viewModel.likesRepository
    val scope = rememberCoroutineScope()
    val likesCount by likesRepository.getLikes(streamId).collectAsState(initial = 0)
    val hasUserLiked by likesRepository.hasUserLiked(streamId).collectAsState(initial = false)
    
    // Función para toggle likes
    fun toggleLike() {
        scope.launch {
            likesRepository.toggleLike(streamId)
        }
    }
    
    // UN SOLO ExoPlayer - sin recreación, sin interrupciones
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build()
    }
    
    // Limpiar player al salir
    DisposableEffect(Unit) {
        onDispose {
            exoPlayer.release()
        }
    }
    
    // Cargar stream inmediatamente sin delays
    LaunchedEffect(streamId) {
        viewModel.loadStreamById(streamId)
        
        // Mostrar modal de donación después de un momento
        delay(5000)
        showDonationModal = true
    }
    
    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading || stream == null) {
            // Pantalla de carga optimizada
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(CosmicBackground),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = CosmicPrimary
                )
            }
        } else {
            // 🚀 ESTRUCTURA CORREGIDA DEFINITIVAMENTE
            if (isFullscreen) {
                // ✅ FULLSCREEN INMERSIVO - OCULTAR/MOSTRAR BARRAS SEGÚN ESTADO
                LaunchedEffect(isFullscreen) {
                    activity?.window?.let { window ->
                        val decorView = window.decorView
                        if (isFullscreen) {
                            decorView.systemUiVisibility = (
                                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                            )
                        }
                    }
                }
                
                // ✅ FULLSCREEN VERDADERO - SOLO EL PLAYER, TODA LA PANTALLA DEL CELULAR
                VideoPlayerUnified(
                    streamUrl = stream?.streamUrl ?: "",
                    streamTitle = stream?.title ?: "",
                    streamId = streamId,
                    isFullscreen = true,
                    onFullscreenToggle = { isFullscreen = false },
                    onExitFullscreen = { isFullscreen = false },
                    onLikeClick = ::toggleLike,
                    likesCount = likesCount,
                    hasUserLiked = hasUserLiked,
                    exoPlayer = exoPlayer,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                // ✅ RESTAURAR BARRAS DEL SISTEMA AL SALIR DE FULLSCREEN
                LaunchedEffect(isFullscreen) {
                    if (!isFullscreen) {
                        activity?.window?.decorView?.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_VISIBLE
                    }
                }
                
                // ✅ MODO NORMAL - CON HEADER, VIDEO Y CHAT COMPLETO
                // ✅ MODO NORMAL - CON HEADER, VIDEO Y CHAT COMPLETO
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(CosmicBackground)
                ) {
                    // Header con título del stream
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(
                                onClick = { 
                                    onBackClick?.invoke() ?: navController?.navigateUp() 
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.ArrowBack,
                                    contentDescription = "Volver",
                                    tint = Color.White
                                )
                            }
                            
                            Column {
                                Text(
                                    text = "BarrileteCosmicoTv",
                                    color = CosmicPrimary,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = getStreamTitle(streamId),
                                    color = Color.White,
                                    fontSize = 14.sp
                                )
                            }
                        }
                        
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            // Indicador en vivo
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = LiveIndicator
                                ),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text(
                                    text = "EN VIVO",
                                    color = Color.White,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                            
                            ViewerCount(
                                streamId = streamId,
                                viewerCount = viewerCount
                            )
                        }
                    }
                    
                    // Área superior - Video y controles
                    Column(
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        // Video player
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(16f / 9f)
                        ) {
                            VideoPlayerUnified(
                                streamUrl = stream?.streamUrl ?: "",
                                streamTitle = stream?.title ?: "",
                                streamId = streamId,
                                isFullscreen = false,
                                onFullscreenToggle = { isFullscreen = true },
                                onExitFullscreen = { isFullscreen = false },
                                onLikeClick = ::toggleLike,
                                likesCount = likesCount,
                                hasUserLiked = hasUserLiked,
                                exoPlayer = exoPlayer, // EL MISMO PLAYER
                                modifier = Modifier.fillMaxSize()
                            )
                        }
                        
                        // Botón de donación
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.End
                        ) {
                            Button(
                                onClick = { showDonationModal = true },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = CosmicPrimary
                                ),
                                shape = RoundedCornerShape(20.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Favorite,
                                    contentDescription = "Donar",
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Apoyar", fontSize = 14.sp)
                            }
                        }
                        
                        // Información del stream
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surface
                            )
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp)
                            ) {
                                Text(
                                    text = "📺 ${getStreamTitle(streamId)}",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = CosmicPrimary
                                )
                                Text(
                                    text = "Transmisión de deportes en vivo - Fútbol argentino",
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                        }
                    }
                    
                    // ✅ CHAT ORIGINAL FUNCIONAL - Con selecci\u00f3n de username
                    SuperChatComponent(
                        streamId = streamId,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(top = 8.dp)
                    )
                }
            }
        }
        
        // ✅ Modal de donación - SOLO en modo normal, NO en fullscreen
        if (showDonationModal && !isFullscreen) {
            DonationModal(
                onDismiss = { showDonationModal = false }
            )
        }
    }
}

@Composable
private fun FullscreenStreamView(
    streamId: String,
    exoPlayer: ExoPlayer, // PASAR ExoPlayer COMO PARÁMETRO
    onExitFullscreen: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        // Video en pantalla completa
        VideoPlayerUnified(
            streamUrl = getStreamUrl(streamId),
            streamId = streamId,
            isFullscreen = true,
            onFullscreenToggle = onExitFullscreen,
            onExitFullscreen = onExitFullscreen,
            exoPlayer = exoPlayer, // AHORA SÍ TIENE ACCESO
            modifier = Modifier.fillMaxSize()
        )
        
        // Header con nombre en fullscreen
        Row(
            modifier = Modifier
                .align(Alignment.TopStart)
                .fillMaxWidth()
                .padding(16.dp)
                .background(
                    Color.Black.copy(alpha = 0.7f),
                    RoundedCornerShape(8.dp)
                )
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "BarrileteCosmicoTv",
                color = CosmicPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = getStreamTitle(streamId),
                color = Color.White,
                fontSize = 14.sp
            )
        }
        
        // Overlay con información
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .background(
                    Color.Black.copy(alpha = 0.7f),
                    shape = RoundedCornerShape(16.dp)
                )
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.PlayArrow,
                contentDescription = "Reproducir",
                tint = Color.White,
                modifier = Modifier.size(96.dp)
            )
            Text(
                text = "Pantalla completa",
                color = Color.White,
                fontSize = 20.sp
            )
            Text(
                text = getStreamTitle(streamId),
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 14.sp
            )
        }
        
        // Botón para salir de pantalla completa
        IconButton(
            onClick = onExitFullscreen,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
        ) {
            Icon(
                imageVector = Icons.Default.FullscreenExit,
                contentDescription = "Salir de pantalla completa",
                tint = Color.White
            )
        }
    }
}

@Composable
private fun DonationModal(
    onDismiss: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.6f))
            .clickable { onDismiss() },
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth(0.9f)
                .wrapContentHeight()
                .clickable { }, // Evita que el click se propague
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = Color.White
            )
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    IconButton(onClick = onDismiss) {
                        Text(
                            text = "❌",
                            fontSize = 18.sp
                        )
                    }
                }
                
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "❤️",
                        fontSize = 20.sp
                    )
                    Text(
                        text = "Apoyá el proyecto",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.Black
                    )
                }
                
                Text(
                    text = "Alias: barriletecosmicoTv",
                    fontSize = 14.sp,
                    color = Color.Black,
                    fontWeight = FontWeight.Medium
                )
                
                // Logos de canales
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // TNT Sports
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .background(
                                Color.Black,
                                shape = RoundedCornerShape(8.dp)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "TNT",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    
                    // ESPN
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .background(
                                Color.Red,
                                shape = RoundedCornerShape(8.dp)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "ESPN",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

// Funciones auxiliares
private fun getStreamTitle(streamId: String): String {
    return when (streamId) {
        "tnt-sports-hd" -> "TNT Sports HD"
        "espn-premium-hd" -> "ESPN Premium HD"
        "directv-sport" -> "DirecTV Sport"
        "directv-plus" -> "DirecTV+"
        "espn-hd" -> "ESPN HD"
        "espn2-hd" -> "ESPN 2 HD"
        "espn3-hd" -> "ESPN 3 HD"
        "fox-sports-hd" -> "Fox Sports HD"
        else -> "Canal Deportivo"
    }
}

// NUEVO SISTEMA DE CHAT SIMPLE - SimpleChatComponent

// Función para obtener URLs reales del backend basadas en streamId
private fun getStreamUrl(streamId: String): String {
    // Mapeo de streamIds comunes a URLs de streaming de ejemplo
    // En producción, esto vendría del backend con las URLs reales de M3U8
    return when (streamId) {
        "espn-hd" -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CqkFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
        "fox-sports" -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CqgFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
        "tntsports-hd" -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CqhFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
        "directv-sport" -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CpEFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
        "tyc-sports" -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CpIFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
        else -> "https://video-weaver.sao01.hls.ttvnw.net/v1/playlist/CqkFghKg6BXjzm8e_RUr5o2RrX7PJmfGYE9YR5jCDEIiQTBTJLJcX8CZmKP1MBm3y4ARgBFy77Z6JzNfwPc-UZS3UZe_TmOQlnFAhvY4t8q1nK6rrNGnHyKJB1E0S5QLPr8M5w0FwdCVzB3-qQ8V7JAOcSJjv2KqIXOKeFfBcqgfE8b5r-wdgWZG5yj8rNsQi_4U6A8e.m3u8"
    }
}