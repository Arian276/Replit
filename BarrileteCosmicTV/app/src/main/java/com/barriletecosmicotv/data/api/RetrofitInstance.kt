package com.barriletecosmicotv.data.api

import com.barriletecosmicotv.data.ConfigManager
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RetrofitInstance @Inject constructor(
    private val configManager: ConfigManager
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(configManager.getConfig().api.timeout, TimeUnit.MILLISECONDS)
        .readTimeout(configManager.getConfig().api.timeout, TimeUnit.MILLISECONDS)
        .writeTimeout(configManager.getConfig().api.timeout, TimeUnit.MILLISECONDS)
        .build()
    
    val api: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(configManager.getConfig().api.baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }
}