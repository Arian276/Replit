package com.barriletecosmicotv

import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel
import com.barriletecosmicotv.navigation.AppNavigation
import com.barriletecosmicotv.ui.theme.BarrileteCosmicTVTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Nuevo sistema de chat simple - sin configuración previa necesaria
        
        setContent {
            BarrileteCosmicTVTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainApp()
                }
            }
        }
    }
}

@Composable
private fun MainApp() {
    // ELIMINAR TUTORIAL COMPLETAMENTE - ir directo a la app
    AppNavigation()
}