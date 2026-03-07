#include <jni.h>
#include <android/log.h>
#include <dlfcn.h>

#define LOG_TAG "VlcAdjustBridge"
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

enum LibVlcAdjustOption {
    LIBVLC_ADJUST_ENABLE = 0,
    LIBVLC_ADJUST_CONTRAST = 1,
    LIBVLC_ADJUST_BRIGHTNESS = 2,
    LIBVLC_ADJUST_HUE = 3,
    LIBVLC_ADJUST_SATURATION = 4,
    LIBVLC_ADJUST_GAMMA = 5,
};

using SetAdjustIntFn = void (*)(void*, unsigned, int);
using SetAdjustFloatFn = void (*)(void*, unsigned, float);

void* gLibVlcHandle = nullptr;
SetAdjustIntFn gSetAdjustInt = nullptr;
SetAdjustFloatFn gSetAdjustFloat = nullptr;
bool gAttemptedLoad = false;

bool ensureLoaded() {
    if (gAttemptedLoad) {
        return gSetAdjustInt != nullptr && gSetAdjustFloat != nullptr;
    }
    gAttemptedLoad = true;

    gLibVlcHandle = dlopen("libvlc.so", RTLD_NOW);
    if (gLibVlcHandle == nullptr) {
        LOGE("Failed to open libvlc.so: %s", dlerror());
        return false;
    }

    gSetAdjustInt = reinterpret_cast<SetAdjustIntFn>(dlsym(gLibVlcHandle, "libvlc_video_set_adjust_int"));
    gSetAdjustFloat = reinterpret_cast<SetAdjustFloatFn>(dlsym(gLibVlcHandle, "libvlc_video_set_adjust_float"));

    if (gSetAdjustInt == nullptr || gSetAdjustFloat == nullptr) {
        LOGE("Failed to resolve adjust symbols");
        return false;
    }

    return true;
}

} // namespace

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_yuanzhou_vlc_vlcplayer_VlcAdjustBridge_nativeIsAvailable(JNIEnv*, jclass) {
    return ensureLoaded() ? JNI_TRUE : JNI_FALSE;
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_yuanzhou_vlc_vlcplayer_VlcAdjustBridge_nativeApplyEnhancement(
        JNIEnv*,
        jclass,
        jlong mediaPlayerHandle,
        jboolean enabled,
        jfloat brightness,
        jfloat contrast,
        jfloat saturation,
        jfloat gamma) {
    if (!ensureLoaded()) {
        LOGW("nativeApplyEnhancement: bridge unavailable");
        return JNI_FALSE;
    }

    void* mediaPlayer = reinterpret_cast<void*>(mediaPlayerHandle);
    if (mediaPlayer == nullptr) {
        LOGW("nativeApplyEnhancement called with null media player");
        return JNI_FALSE;
    }

    const bool enhance = enabled == JNI_TRUE;

    gSetAdjustFloat(mediaPlayer, LIBVLC_ADJUST_BRIGHTNESS, enhance ? brightness : 1.0f);
    gSetAdjustFloat(mediaPlayer, LIBVLC_ADJUST_CONTRAST, enhance ? contrast : 1.0f);
    gSetAdjustFloat(mediaPlayer, LIBVLC_ADJUST_SATURATION, enhance ? saturation : 1.0f);
    gSetAdjustFloat(mediaPlayer, LIBVLC_ADJUST_GAMMA, enhance ? gamma : 1.0f);
    gSetAdjustInt(mediaPlayer, LIBVLC_ADJUST_ENABLE, enhance ? 1 : 0);

    return JNI_TRUE;
}
