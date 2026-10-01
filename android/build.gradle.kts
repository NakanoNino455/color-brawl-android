// Top-level build file. Plugin versions come from gradle/libs.versions.toml.
// AGP 9.x carries its own Kotlin support, so no separate Kotlin plugin is applied here.
plugins {
    alias(libs.plugins.android.application) apply false
}
