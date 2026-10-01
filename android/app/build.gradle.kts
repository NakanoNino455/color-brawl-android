import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Release signing is read from local.properties (never committed) or environment variables.
// If neither is present, the release build is signed with the debug key so `assembleRelease`
// always produces an installable APK. See README-ANDROID.md for producing a real key.
val keystoreProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? =
    (keystoreProps.getProperty(key) ?: System.getenv(env))?.takeIf { it.isNotBlank() }

val releaseStorePath = signingValue("COLORBRAWL_STORE_FILE", "COLORBRAWL_STORE_FILE")
val hasReleaseKey = releaseStorePath != null && rootProject.file(releaseStorePath).exists()

android {
    namespace = "com.colorbrawl.android"

    // The installed SDK on this machine is platform 36 + build-tools 36.0.0.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.colorbrawl.android"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(releaseStorePath!!)
                storePassword = signingValue("COLORBRAWL_STORE_PASSWORD", "COLORBRAWL_STORE_PASSWORD")
                keyAlias = signingValue("COLORBRAWL_KEY_ALIAS", "COLORBRAWL_KEY_ALIAS")
                keyPassword = signingValue("COLORBRAWL_KEY_PASSWORD", "COLORBRAWL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig =
                if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    // The game ships ~24 MB of web assets. Keeping these uncompressed lets the WebView's
    // asset loader stream them straight out of the APK instead of through a zip inflater.
    androidResources {
        noCompress += listOf("webp", "woff2", "png", "json", "wasm")
    }

    packaging {
        resources {
            excludes += setOf("META-INF/*.version", "META-INF/LICENSE*", "META-INF/NOTICE*")
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.activity)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
