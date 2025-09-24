package com.barriletecosmicotv.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.barriletecosmicotv.ui.theme.*

@Composable
fun TSVideoControlsImproved(
    isPlaying: Boolean,
    isFullscreen: Boolean,
    likesCount: Int,
    hasUserLiked: Boolean,
    onPlayPause: () -> Unit,
    onFullscreen: (() -> Unit)?,
    onLikeClick: (() -> Unit)?,
    onCastClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier) {
        // Overlay degradado más sutil en pantalla completa
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = if (isFullscreen) listOf(
                            Color.Black.copy(alpha = 0.4f),
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.6f)
                        ) else listOf(
                            Color.Transparent,
                            Color.Black.copy(alpha = 0.3f),
                            Color.Black.copy(alpha = 0.7f)
                        )
                    )
                )
        )
        
        // Controles superiores (solo en pantalla completa)
        if (isFullscreen) {
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Botón de Cast (removido - ahora se usa en VideoPlayerUnified)
                // GoogleCastButton integrado en VideoPlayerUnified
                
                // Botón cerrar pantalla completa
                IconButton(
                    onClick = { onFullscreen?.invoke() },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.6f))
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Salir de pantalla completa",
                        tint = Color.White,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
        
        // Botón play/pause central con animación especial
        Box(
            modifier = Modifier.align(Alignment.Center),
            contentAlignment = Alignment.Center
        ) {
            val infiniteTransition = rememberInfiniteTransition(label = "playButtonPulse")
            val pulseScale by infiniteTransition.animateFloat(
                initialValue = 1f,
                targetValue = if (isFullscreen) 1.1f else 1.08f,
                animationSpec = infiniteRepeatable(
                    animation = tween(1200, easing = FastOutSlowInEasing),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "pulseScale"
            )
            
            IconButton(
                onClick = onPlayPause,
                modifier = Modifier
                    .size(if (isFullscreen) 100.dp else 80.dp)
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                CosmicPrimary.copy(alpha = 0.9f),
                                CosmicSecondary.copy(alpha = 0.7f)
                            )
                        ),
                        CircleShape
                    )
                    .graphicsLayer { 
                        if (!isPlaying) {
                            scaleX = pulseScale
                            scaleY = pulseScale 
                        }
                    }
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (isPlaying) "Pausar" else "Reproducir",
                    tint = Color.White,
                    modifier = Modifier.size(if (isFullscreen) 40.dp else 32.dp)
                )
            }
        }
        
        // Controles inferiores
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(if (isFullscreen) 24.dp else 16.dp)
        ) {
            // Barra de progreso
            TSProgressBar(
                modifier = Modifier.fillMaxWidth()
            )
            
            Spacer(modifier = Modifier.height(12.dp))
            
            // Fila de controles principal
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Lado izquierdo: Información del stream
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.VideoFile,
                        contentDescription = "ExoPlayer",
                        tint = CosmicSecondary,
                        modifier = Modifier.size(16.dp)
                    )
                    
                    Text(
                        text = "ExoPlayer",
                        color = CosmicPrimary,
                        fontSize = if (isFullscreen) 14.sp else 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                
                // Centro: Botón de likes
                if (onLikeClick != null) {
                    LikeButton(
                        likesCount = likesCount,
                        hasUserLiked = hasUserLiked,
                        onLikeClick = onLikeClick
                    )
                }
                
                // Lado derecho: Controles adicionales
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Cast button integrado en VideoPlayerUnified
                    // (removido para evitar duplicación)
                    
                    // Configuración
                    IconButton(onClick = { /* TODO: Implementar configuración */ }) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Configuración",
                            tint = Color.White,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    
                    // Pantalla completa
                    if (onFullscreen != null) {
                        IconButton(onClick = onFullscreen) {
                            Icon(
                                imageVector = if (isFullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen,
                                contentDescription = if (isFullscreen) "Salir de pantalla completa" else "Pantalla completa",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TSProgressBar(
    modifier: Modifier = Modifier
) {
    // Barra de progreso animada para streams en vivo
    val infiniteTransition = rememberInfiniteTransition(label = "liveProgress")
    val progress by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2500, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "liveProgressAnimation"
    )
    
    Box(
        modifier = modifier
            .height(4.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(Color.White.copy(alpha = 0.3f))
    ) {
        // Stream live progress
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.7f + progress * 0.3f)
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(
                            CosmicPrimary,
                            CosmicSecondary,
                            ArgentinaPassion
                        )
                    )
                )
        )
        
        // Live indicator
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(LiveIndicator, CircleShape)
                .align(Alignment.CenterEnd)
                .offset(x = (-4).dp)
        )
    }
}