package com.barriletecosmicotv.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.barriletecosmicotv.ui.theme.*

@Composable
fun SearchBar(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    placeholder: String = "Buscar canales deportivos...",
    modifier: Modifier = Modifier
) {
    var isFocused by remember { mutableStateOf(false) }
    val keyboardController = LocalSoftwareKeyboardController.current
    
    // Colores animados basados en el foco
    val borderColor by animateColorAsState(
        targetValue = if (isFocused) CosmicPrimary else Color.White.copy(alpha = 0.3f),
        animationSpec = tween(300),
        label = "border_color"
    )
    
    val backgroundColor by animateColorAsState(
        targetValue = if (isFocused) 
            Color.White.copy(alpha = 0.15f) 
        else 
            Color.White.copy(alpha = 0.1f),
        animationSpec = tween(300),
        label = "background_color"
    )
    
    OutlinedTextField(
        value = searchQuery,
        onValueChange = onSearchQueryChange,
        placeholder = {
            Text(
                text = placeholder,
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 14.sp
            )
        },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = "Buscar",
                tint = if (isFocused) CosmicPrimary else Color.White.copy(alpha = 0.7f),
                modifier = Modifier.size(20.dp)
            )
        },
        trailingIcon = {
            if (searchQuery.isNotEmpty()) {
                IconButton(
                    onClick = { 
                        onSearchQueryChange("")
                        keyboardController?.hide()
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Clear,
                        contentDescription = "Limpiar búsqueda",
                        tint = Color.White.copy(alpha = 0.7f),
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        },
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Words,
            imeAction = ImeAction.Search
        ),
        keyboardActions = KeyboardActions(
            onSearch = {
                keyboardController?.hide()
            }
        ),
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = Color.White,
            unfocusedTextColor = Color.White,
            focusedBorderColor = borderColor,
            unfocusedBorderColor = borderColor,
            cursorColor = CosmicPrimary,
            focusedContainerColor = backgroundColor,
            unfocusedContainerColor = backgroundColor
        ),
        shape = RoundedCornerShape(25.dp),
        modifier = modifier
            .fillMaxWidth()
            .onFocusChanged { focusState ->
                isFocused = focusState.isFocused
            }
    )
}

@Composable
fun SearchResultsHeader(
    totalResults: Int,
    searchQuery: String,
    modifier: Modifier = Modifier
) {
    if (searchQuery.isNotEmpty()) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "Resultados de búsqueda",
                    color = Color.White.copy(alpha = 0.9f),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = if (totalResults == 0) {
                        "No se encontraron canales para \"$searchQuery\""
                    } else {
                        "$totalResults canal${if (totalResults != 1) "es" else ""} encontrado${if (totalResults != 1) "s" else ""}"
                    },
                    color = CosmicPrimary,
                    fontSize = 12.sp
                )
            }
            
            if (totalResults > 0) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = CosmicSecondary.copy(alpha = 0.8f)
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        text = totalResults.toString(),
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun NoResultsFound(
    searchQuery: String,
    onClearSearch: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Icono de búsqueda vacía
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = "Sin resultados",
            tint = Color.White.copy(alpha = 0.4f),
            modifier = Modifier.size(64.dp)
        )
        
        Text(
            text = "No se encontraron canales",
            color = Color.White.copy(alpha = 0.9f),
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium
        )
        
        Text(
            text = "No hay canales que coincidan con \"$searchQuery\".\nIntenta con otro término de búsqueda.",
            color = Color.White.copy(alpha = 0.7f),
            fontSize = 14.sp,
            lineHeight = 20.sp
        )
        
        Button(
            onClick = onClearSearch,
            colors = ButtonDefaults.buttonColors(
                containerColor = CosmicPrimary.copy(alpha = 0.8f)
            ),
            shape = RoundedCornerShape(20.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Clear,
                contentDescription = null,
                modifier = Modifier.size(16.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Limpiar búsqueda",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}