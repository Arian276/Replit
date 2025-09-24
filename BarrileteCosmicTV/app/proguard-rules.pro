# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ===== GOOGLE CAST SDK RULES =====
# Keep CastOptionsProvider
-keep public class * implements com.google.android.gms.cast.framework.OptionsProvider

# Keep your specific CastOptionsProvider class
-keep class com.barriletecosmicotv.cast.CastOptionsProvider { *; }

# Keep MediaRouteActionProvider for menu items
-keep public class androidx.mediarouter.app.MediaRouteActionProvider { 
    public <methods>; 
}

# Keep MediaRouteButton
-keep class androidx.mediarouter.app.MediaRouteButton { *; }

# Google Cast framework classes
-keep class com.google.android.gms.cast.** { *; }
-dontwarn com.google.auto.value.**

# Keep all proto fields for Cast SDK
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
    <fields>;
}

# Keep cast intent receivers
-keep class com.barriletecosmicotv.cast.** { *; }

# AndroidX MediaRouter
-keep class androidx.mediarouter.** { *; }

# Support library (if any legacy components)
-keep class android.support.** { *; }

# General Google classes
-keep class com.google.** { *; }