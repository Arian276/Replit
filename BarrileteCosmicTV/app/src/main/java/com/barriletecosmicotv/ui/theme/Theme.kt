package com.barriletecosmicotv.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// Esquema de colores personalizado para BarrileteCosmico TV (Tema Argentino)
private val BarrileteCosmicColorScheme = darkColorScheme(
    primary = CosmicPrimary, // Argentina Celeste
    onPrimary = CosmicOnPrimary,
    primaryContainer = CosmicPrimaryVariant,
    onPrimaryContainer = CosmicOnPrimary,
    
    secondary = CosmicSecondary, // Argentina Orange
    onSecondary = CosmicOnSecondary,
    secondaryContainer = CosmicSecondaryVariant,
    onSecondaryContainer = CosmicOnSecondary,
    
    tertiary = ArgentinaEnergy, // Magenta energético
    onTertiary = CosmicOnPrimary,
    
    background = CosmicBackground, // Fondo muy oscuro
    onBackground = CosmicOnBackground,
    
    surface = CosmicSurface, // Superficies oscuras
    onSurface = CosmicOnSurface,
    surfaceVariant = CosmicCard,
    onSurfaceVariant = CosmicMuted,
    
    outline = CosmicBorder,
    outlineVariant = CosmicBorder,
    
    error = Color(0xFFEF4444),
    onError = CosmicOnPrimary,
    
    inverseSurface = CosmicOnSurface,
    inverseOnSurface = CosmicSurface,
    inversePrimary = CosmicPrimaryVariant
)

// Esquema de colores claro (opcional, pero mantenemos consistencia con tema oscuro)
private val BarrileteCosmicLightColorScheme = lightColorScheme(
    primary = CosmicPrimary,
    onPrimary = CosmicOnPrimary,
    secondary = CosmicSecondary,
    onSecondary = CosmicOnSecondary,
    background = Color(0xFFFFFBFE),
    onBackground = Color(0xFF1C1B1F),
    surface = Color(0xFFFFFBFE),
    onSurface = Color(0xFF1C1B1F)
)

@Composable
fun BarrileteCosmicTVTheme(
    darkTheme: Boolean = true, // Forzamos tema oscuro por defecto
    dynamicColor: Boolean = false, // Deshabilitamos colores dinámicos para mantener tema argentino
    content: @Composable () -> Unit
) {
    // Siempre usamos nuestro esquema personalizado argentino
    val colorScheme = if (darkTheme) {
        BarrileteCosmicColorScheme
    } else {
        BarrileteCosmicLightColorScheme
    }
    
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = CosmicBackground.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}