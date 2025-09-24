package com.barriletecosmicotv.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import coil.compose.AsyncImage
import com.barriletecosmicotv.components.AnimatedSoccerButton
import com.barriletecosmicotv.components.ViewerCount
import com.barriletecosmicotv.components.SearchBar
import com.barriletecosmicotv.components.SearchResultsHeader
import com.barriletecosmicotv.components.NoResultsFound
import com.barriletecosmicotv.model.Stream
import com.barriletecosmicotv.model.Category
import com.barriletecosmicotv.ui.theme.*
import com.barriletecosmicotv.viewmodel.StreamViewModel
import kotlinx.coroutines.delay
// Pull-to-refresh implementation using Box and LaunchedEffect

// Solo usar canales del backend - sin datos hardcodeados
private val channelLogos = emptyMap<String, String>()

// Función para generar logo basado en nombre del canal
private fun getChannelLogo(channel: Stream): String {
    return channelLogos[channel.id] ?: channel.thumbnailUrl.ifEmpty {
        "https://via.placeholder.com/150x80/1976D2/FFFFFF?text=${channel.title.replace(" ", "+")}"
    }
}

@Composable
fun HomeScreen(
    navController: NavController? = null,
    onStreamClick: ((String) -> Unit)? = null,
    viewModel: StreamViewModel = hiltViewModel()
) {
    val streams by viewModel.streams.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    
    // Estados de búsqueda y filtros
    var searchQuery by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("todas") }
    val categories by viewModel.categories.collectAsState()
    
    // Estados del drawer
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    
    // Filtrar streams basado en la búsqueda y categoría
    val filteredStreams = remember(streams, searchQuery, selectedCategory) {
        var filtered = streams
        
        // Filtrar por categoría si no es "todas"
        if (selectedCategory != "todas") {
            filtered = filtered.filter { stream ->
                stream.category.lowercase() == selectedCategory.lowercase()
            }
        }
        
        // Filtrar por búsqueda
        if (searchQuery.isNotEmpty()) {
            filtered = filtered.filter { stream ->
                stream.title.contains(searchQuery, ignoreCase = true) ||
                stream.description.contains(searchQuery, ignoreCase = true) ||
                stream.category.contains(searchQuery, ignoreCase = true)
            }
        }
        
        filtered
    }
    
    // Cargar streams y categorías al inicio
    LaunchedEffect(Unit) {
        viewModel.loadStreams()
        viewModel.loadCategories()
    }
    
    // Navegación con drawer lateral
    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            // Contenido del drawer lateral
            CategoryDrawerContent(
                categories = categories,
                selectedCategory = selectedCategory,
                onCategoryChange = { 
                    selectedCategory = it
                    scope.launch { drawerState.close() }
                }
            )
        }
    ) {
        if (isLoading && streams.isEmpty()) {
            LoadingScreen()
        } else {
            Box(modifier = Modifier.fillMaxSize()) {
                // Contenido principal SIN dropdown de categorías
                MainContent(
                    streams = filteredStreams,
                    searchQuery = searchQuery,
                    onSearchQueryChange = { searchQuery = it },
                    isRefreshing = isLoading,
                    onRefresh = { 
                        viewModel.loadStreams()
                        viewModel.loadCategories()
                    },
                    onStreamClick = { streamId ->
                        onStreamClick?.invoke(streamId)
                        navController?.navigate("stream/$streamId")
                    }
                )
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Icono giratorio
            val infiniteTransition = rememberInfiniteTransition(label = "rotation")
            val rotation by infiniteTransition.animateFloat(
                initialValue = 0f,
                targetValue = 360f,
                animationSpec = infiniteRepeatable(
                    animation = tween(2000, easing = LinearEasing),
                    repeatMode = RepeatMode.Restart
                ),
                label = "rotation"
            )
            
            Icon(
                imageVector = Icons.Default.Tv,
                contentDescription = null,
                tint = CosmicPrimary,
                modifier = Modifier
                    .size(48.dp)
                    .graphicsLayer { rotationZ = rotation }
            )
            
            Text(
                text = "Cargando canales...",
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun MainContent(
    streams: List<Stream>,
    searchQuery: String = "",
    onSearchQueryChange: (String) -> Unit = {},
    isRefreshing: Boolean = false,
    onRefresh: () -> Unit = {},
    onStreamClick: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Header argentino
        ArgentinaHeader()
        
        // Barra de búsqueda
        SearchBar(
            searchQuery = searchQuery,
            onSearchQueryChange = onSearchQueryChange,
            placeholder = "Buscar canales deportivos...",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        
        // Resultados de búsqueda header
        if (searchQuery.isNotEmpty()) {
            SearchResultsHeader(
                totalResults = streams.size,
                searchQuery = searchQuery
            )
        }
        
        // Indicador de refresh
        if (isRefreshing && streams.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    color = CosmicPrimary,
                    strokeWidth = 2.dp
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Actualizando canales...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        
        // Grid de canales o sin resultados
        if (streams.isEmpty() && searchQuery.isNotEmpty()) {
            // Sin resultados de búsqueda
            NoResultsFound(
                searchQuery = searchQuery,
                onClearSearch = { onSearchQueryChange("") }
            )
        } else if (streams.isEmpty()) {
            // Mensaje cuando no hay canales
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Tv,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.size(48.dp)
                    )
                    Text(
                        text = "No hay canales disponibles",
                        color = MaterialTheme.colorScheme.outline,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "Desliza hacia abajo para actualizar",
                        color = MaterialTheme.colorScheme.outline,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(280.dp),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                itemsIndexed(streams) { index, stream ->
                    ChannelCard(
                        stream = stream,
                        animationDelay = (index * 100).coerceAtMost(500),
                        onWatchClick = { onStreamClick(stream.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ArgentinaHeader() {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Logo animado
                val infiniteTransition = rememberInfiniteTransition(label = "logoSpin")
                val rotation by infiniteTransition.animateFloat(
                    initialValue = 0f,
                    targetValue = 360f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(4000, easing = LinearEasing),
                        repeatMode = RepeatMode.Restart
                    ),
                    label = "logoRotation"
                )
                
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(
                            Brush.linearGradient(
                                colors = listOf(CosmicPrimary, CosmicSecondary)
                            ),
                            RoundedCornerShape(12.dp)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Tv,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier
                            .size(24.dp)
                            .graphicsLayer { rotationZ = rotation }
                    )
                }
                
                Column {
                    // Título con gradiente argentino
                    Text(
                        text = "Barrilete Cósmico",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = CosmicPrimary,
                        modifier = Modifier
                    )
                    
                    Text(
                        text = "Fútbol argentino • Pasión • En vivo",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            
            // Badge EN VIVO mejorado
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                LiveBadge()
            }
        }
    }
}

@Composable
private fun LiveBadge() {
    val infiniteTransition = rememberInfiniteTransition(label = "livePulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )
    
    Surface(
        modifier = Modifier
            .graphicsLayer { scaleX = pulseScale; scaleY = pulseScale },
        color = LiveIndicator,
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Icon(
                imageVector = Icons.Default.NetworkCheck,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(10.dp)
            )
            
            Text(
                text = "VIVO",
                color = Color.White,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun ChannelCard(
    stream: Stream,
    animationDelay: Int,
    onWatchClick: () -> Unit
) {
    var isHovered by remember { mutableStateOf(false) }
    
    // Animación de entrada
    val animationSpec = tween<Float>(
        durationMillis = 600,
        delayMillis = animationDelay,
        easing = FastOutSlowInEasing
    )
    
    val alpha by animateFloatAsState(
        targetValue = 1f,
        animationSpec = animationSpec,
        label = "alpha"
    )
    
    val translateY by animateFloatAsState(
        targetValue = 0f,
        animationSpec = animationSpec,
        label = "translateY"
    )
    
    // Animación hover
    val scale by animateFloatAsState(
        targetValue = if (isHovered) 1.02f else 1f,
        animationSpec = tween(300, easing = FastOutSlowInEasing),
        label = "hoverScale"
    )
    
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                this.alpha = alpha
                this.translationY = translateY * 50f
                this.scaleX = scale
                this.scaleY = scale
            },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isHovered) 12.dp else 4.dp
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // Header del canal
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stream.title,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isHovered) CosmicPrimary else MaterialTheme.colorScheme.onSurface
                    )
                    
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                text = stream.category,
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                        
                        Surface(
                            color = CosmicSecondary.copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                text = "HD",
                                fontSize = 10.sp,
                                color = CosmicSecondary,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                        
                    }
                }
                
                ViewerCount(streamId = stream.id)
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            
            // Logo del canal con overlay EN VIVO
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(100.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = getChannelLogo(stream),
                    contentDescription = stream.title,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = if (isHovered) 1.1f else 1f
                            scaleY = if (isHovered) 1.1f else 1f
                        },
                    contentScale = ContentScale.Fit
                )
                
                // Etiqueta EN VIVO en esquina superior izquierda
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .offset(x = 8.dp, y = 8.dp),
                    color = Color(0xFFD32F2F),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        text = "EN VIVO",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        letterSpacing = 0.5.sp,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            // Botón VER AHORA
            AnimatedSoccerButton(
                streamId = stream.id,
                onWatchClick = onWatchClick
            )
        }
    }
}

@Composable 
private fun CategoryDropdown(
    categories: List<Category>,
    selectedCategory: String,
    onCategoryChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    val displayName = if (selectedCategory == "todas") "Todas las Categorías" 
                     else categories.find { it.name == selectedCategory }?.displayName ?: selectedCategory

    Box(modifier = modifier) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(
                imageVector = Icons.Default.Category,
                contentDescription = null,
                tint = CosmicPrimary,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = displayName,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f)
            )
            Icon(
                imageVector = Icons.Default.ExpandMore,
                contentDescription = "Expandir",
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            // Opción "Todas"
            DropdownMenuItem(
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "Todas las Categorías",
                            color = if (selectedCategory == "todas") CosmicPrimary 
                                   else MaterialTheme.colorScheme.onSurface
                        )
                        if (selectedCategory == "todas") {
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "${categories.sumOf { it.count }}",
                                color = CosmicSecondary,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                },
                onClick = { 
                    onCategoryChange("todas")
                    expanded = false
                }
            )
            
            // Categorías disponibles
            categories.forEach { category ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = category.displayName,
                                color = if (selectedCategory == category.name) CosmicPrimary 
                                       else MaterialTheme.colorScheme.onSurface
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = category.count.toString(),
                                color = CosmicSecondary,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    },
                    onClick = { 
                        onCategoryChange(category.name)
                        expanded = false
                    }
                )
            }
        }
    }
}

// Contenido del drawer lateral con categorías
@Composable
private fun CategoryDrawerContent(
    categories: List<Category>,
    selectedCategory: String,
    onCategoryChange: (String) -> Unit
) {
    ModalDrawerSheet(
        modifier = Modifier.fillMaxWidth(0.75f), // 75% del ancho de pantalla
        drawerContentColor = MaterialTheme.colorScheme.onSurface,
        drawerContainerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
            // Header del drawer
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Category,
                    contentDescription = null,
                    tint = CosmicPrimary,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "Categorías",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = CosmicPrimary
                )
            }
            
            Divider(
                modifier = Modifier.padding(vertical = 8.dp),
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
            )
            
            // Opción "Todas"
            CategoryDrawerItem(
                text = "Todas las Categorías",
                count = categories.sumOf { it.count },
                isSelected = selectedCategory == "todas",
                onClick = { onCategoryChange("todas") }
            )
            
            // Categorías disponibles
            categories.forEach { category ->
                CategoryDrawerItem(
                    text = category.displayName,
                    count = category.count,
                    isSelected = selectedCategory == category.name,
                    onClick = { onCategoryChange(category.name) }
                )
            }
            
            Spacer(modifier = Modifier.weight(1f))
            
            // Footer del drawer
            Text(
                text = "BarrileteCósmico TV",
                fontSize = 14.sp,
                color = CosmicPrimary.copy(alpha = 0.7f),
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(vertical = 16.dp)
            )
        }
    }
}

@Composable
private fun CategoryDrawerItem(
    text: String,
    count: Int,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() },
        color = if (isSelected) CosmicPrimary.copy(alpha = 0.1f) else Color.Transparent
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = text,
                fontSize = 16.sp,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                color = if (isSelected) CosmicPrimary else MaterialTheme.colorScheme.onSurface
            )
            
            Surface(
                color = if (isSelected) CosmicPrimary else CosmicSecondary.copy(alpha = 0.7f),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    text = count.toString(),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }
    }
}