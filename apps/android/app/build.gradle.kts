import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI passes these (see .github/workflows/android.yml). Play rejects an upload whose versionCode
// is not higher than every earlier upload, so CI uses the workflow run number.
val versionCodeProp = (findProperty("versionCode") as String?)?.toInt() ?: 1
val versionNameProp = (findProperty("versionName") as String?) ?: "1.0"

// Upload-key signing, from environment variables so no secret is ever in the repo.
// Without ANDROID_KEYSTORE_PATH the release build is unsigned (fine locally, rejected by Play).
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.torahlearningtools.wrapper"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        targetSdk = 36
        versionCode = versionCodeProp
        versionName = versionNameProp
    }

    buildFeatures {
        buildConfig = true
    }

    // One flavor per web app. NEVER change an applicationId after the app is on Play:
    // a new id is a brand-new app with no installs.
    flavorDimensions += "app"
    productFlavors {
        create("flashcards") {
            dimension = "app"
            applicationId = "com.torahlearningtools.chederflashcards"
            buildConfigField("String", "START_URL", "\"https://chederflashcards.torahlearningtools.com/\"")
        }
        create("baalpeh") {
            dimension = "app"
            applicationId = "com.torahlearningtools.baalpeh"
            buildConfigField("String", "START_URL", "\"https://byheart.torahlearningtools.com/\"")
        }
    }

    signingConfigs {
        if (keystorePath != null) {
            create("upload") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "upload"
                // PKCS12 keystores (keytool's default) use one password for the store and the key.
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            // Lets a debug build sit next to the Play build on the same phone.
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (keystorePath != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // The pinned AGP/library versions are deliberate; don't fail CI when newer ones ship.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
        abortOnError = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
}
