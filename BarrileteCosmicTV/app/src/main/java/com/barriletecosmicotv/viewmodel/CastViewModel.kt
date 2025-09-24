package com.barriletecosmicotv.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.barriletecosmicotv.casting.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import androidx.media3.exoplayer.ExoPlayer
import javax.inject.Inject

@HiltViewModel
class CastViewModel @Inject constructor(
    private val universalCastManager: UniversalCastManager
) : ViewModel() {
    
    val castConnectionState: StateFlow<CastConnectionState> = universalCastManager.castConnectionState
    val availableDevices: StateFlow<List<CastDevice>> = universalCastManager.availableDevices
    
    fun startDiscovery() {
        universalCastManager.startDeviceDiscovery()
    }
    
    fun stopDiscovery() {
        universalCastManager.stopDeviceDiscovery()
    }
    
    fun connectToDevice(device: CastDevice) {
        viewModelScope.launch {
            universalCastManager.connectToDevice(device)
        }
    }
    
    fun disconnect() {
        universalCastManager.disconnect()
    }
    
    fun castCurrentStream(streamUrl: String, streamTitle: String) {
        viewModelScope.launch {
            universalCastManager.castCurrentStream(streamUrl, streamTitle)
        }
    }
    
    fun setLocalPlayer(player: ExoPlayer) {
        universalCastManager.setLocalPlayer(player)
    }
    
    override fun onCleared() {
        super.onCleared()
        universalCastManager.release()
    }
}