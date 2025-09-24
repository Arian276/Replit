package com.barriletecosmicotv.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.barriletecosmicotv.screens.HomeScreen
import com.barriletecosmicotv.screens.StreamScreen

@Composable
fun NavGraph(navController: NavHostController) {
    NavHost(
        navController = navController,
        startDestination = Screens.HOME
    ) {
        composable(route = Screens.HOME) {
            HomeScreen(navController = navController)
        }
        
        composable(
            route = "${Screens.STREAM}/{streamId}",
            arguments = listOf(
                navArgument("streamId") {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val streamId = backStackEntry.arguments?.getString("streamId") ?: ""
            StreamScreen(
                navController = navController,
                streamId = streamId
            )
        }
    }
}