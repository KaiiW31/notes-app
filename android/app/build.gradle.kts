plugins {
    id("com.android.application")
}

val generatedLauncherIconDirectory = layout.buildDirectory.dir("generated/notes-launcher-icon")
val generateLauncherIcon by tasks.registering(Copy::class) {
    from(rootProject.file("../public/icons/notes-icon.png"))
    into(generatedLauncherIconDirectory.map { it.dir("drawable-nodpi") })
    rename { "notes_icon.png" }
}

android {
    namespace = "app.opennotes.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.opennotes.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    sourceSets {
        getByName("main").assets.srcDir("../../dist")
        getByName("main").res.srcDir(generatedLauncherIconDirectory)
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild").configure {
    dependsOn(generateLauncherIcon)
}
