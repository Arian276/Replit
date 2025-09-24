package com.barriletecosmicotv.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.barriletecosmicotv.data.repository.StreamRepository
import com.barriletecosmicotv.data.ViewerTracker
import com.barriletecosmicotv.data.LikesRepository
import com.barriletecosmicotv.model.Stream
import com.barriletecosmicotv.model.Category
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class StreamViewModel @Inject constructor(
    private val streamRepository: StreamRepository,
    private val viewerTracker: ViewerTracker,
    val likesRepository: LikesRepository
) : ViewModel() {
    
    private val _streams = MutableStateFlow<List<Stream>>(emptyList())
    val streams: StateFlow<List<Stream>> = _streams.asStateFlow()
    
    private val _featuredStreams = MutableStateFlow<List<Stream>>(emptyList())
    val featuredStreams: StateFlow<List<Stream>> = _featuredStreams.asStateFlow()
    
    private val _currentStream = MutableStateFlow<Stream?>(null)
    val currentStream: StateFlow<Stream?> = _currentStream.asStateFlow()
    
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    
    private val _searchResults = MutableStateFlow<List<Stream>>(emptyList())
    val searchResults: StateFlow<List<Stream>> = _searchResults.asStateFlow()
    
    private val _viewerCount = MutableStateFlow(0)
    val viewerCount: StateFlow<Int> = _viewerCount.asStateFlow()
    
    private val _categories = MutableStateFlow<List<Category>>(emptyList())
    val categories: StateFlow<List<Category>> = _categories.asStateFlow()
    
    fun loadStreams() {
        viewModelScope.launch {
            println("🎯 StreamViewModel: Iniciando loadStreams()")
            _isLoading.value = true
            streamRepository.getStreams().collect { streamList ->
                println("📺 StreamViewModel: Recibidos ${streamList.size} canales del repository")
                _streams.value = streamList
                _isLoading.value = false
                println("✅ StreamViewModel: Estado actualizado - streams: ${streamList.size}, loading: false")
            }
        }
    }
    
    fun loadFeaturedStreams() {
        viewModelScope.launch {
            _isLoading.value = true
            streamRepository.getFeaturedStreams().collect { streamList ->
                _featuredStreams.value = streamList
                _isLoading.value = false
            }
        }
    }
    
    fun loadStreamById(streamId: String) {
        viewModelScope.launch {
            _isLoading.value = true
            streamRepository.getStreamById(streamId).collect { stream ->
                _currentStream.value = stream
                _isLoading.value = false
                
                // Unirse al stream para tracking real
                if (stream != null) {
                    viewerTracker.joinStream(streamId)
                    startViewerCountUpdates(streamId)
                }
            }
        }
    }
    
    private fun startViewerCountUpdates(streamId: String) {
        viewModelScope.launch {
            while (true) {
                delay(10000) // Cada 10 segundos
                try {
                    val count = viewerTracker.getCurrentViewerCount(streamId)
                    _viewerCount.value = count
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }
    
    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch {
            viewerTracker.leaveCurrentStream()
        }
    }
    
    fun searchStreams(query: String) {
        viewModelScope.launch {
            _isLoading.value = true
            streamRepository.searchStreams(query).collect { streamList ->
                _searchResults.value = streamList
                _isLoading.value = false
            }
        }
    }
    
    fun clearSearch() {
        _searchResults.value = emptyList()
    }
    
    fun loadCategories() {
        viewModelScope.launch {
            streamRepository.getCategories().collect { categoryList ->
                _categories.value = categoryList
            }
        }
    }
}