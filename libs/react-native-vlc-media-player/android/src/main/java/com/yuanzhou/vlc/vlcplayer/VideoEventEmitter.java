package com.yuanzhou.vlc.vlcplayer;

import androidx.annotation.StringDef;
import android.view.View;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.RCTEventEmitter;


import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

class VideoEventEmitter {

    private final RCTEventEmitter eventEmitter;

    private int viewId = View.NO_ID;

    VideoEventEmitter(ReactContext reactContext) {
        this.eventEmitter = reactContext.getJSModule(RCTEventEmitter.class);
    }

    public static final String EVENT_LOAD_START = "onVideoLoadStart";
    public static final String EVENT_ON_OPEN = "onVideoOpen";
    public static final String EVENT_PROGRESS = "onVideoProgress";
    public static final String EVENT_SEEK = "onVideoSeek";
    public static final String EVENT_END = "onVideoEnd";
    public static final String EVENT_ON_IS_PLAYING= "onVideoPlaying";
    public static final String EVENT_ON_VIDEO_STATE_CHANGE = "onVideoStateChange";
    public static final String EVENT_ON_VIDEO_STOPPED = "onVideoStopped";
    public static final String EVENT_ON_ERROR = "onVideoError";
    public static final String EVENT_ON_VIDEO_BUFFERING = "onVideoBuffering";
    public static final String EVENT_ON_PAUSED = "onVideoPaused";
    public static final String EVENT_ON_LOAD = "onVideoLoad";
    public static final String EVENT_RECORDING_STATE = "onRecordingState";
    public static final String EVENT_ON_SNAPSHOT = "onSnapshot";

    static final String[] Events = {
            EVENT_LOAD_START,
            EVENT_PROGRESS,
            EVENT_SEEK,
            EVENT_END,
            EVENT_ON_IS_PLAYING,
            EVENT_ON_VIDEO_STATE_CHANGE,
            EVENT_ON_OPEN,
            EVENT_ON_PAUSED,
            EVENT_ON_VIDEO_BUFFERING,
            EVENT_ON_ERROR,
            EVENT_ON_VIDEO_STOPPED,
            EVENT_ON_LOAD,
            EVENT_RECORDING_STATE,
            EVENT_ON_SNAPSHOT
    };

    @Retention(RetentionPolicy.SOURCE)
    @StringDef({
            EVENT_LOAD_START,
            EVENT_PROGRESS,
            EVENT_SEEK,
            EVENT_END,
            EVENT_ON_IS_PLAYING,
            EVENT_ON_VIDEO_STATE_CHANGE,
            EVENT_ON_OPEN,
            EVENT_ON_PAUSED,
            EVENT_ON_VIDEO_BUFFERING,
            EVENT_ON_ERROR,
            EVENT_ON_VIDEO_STOPPED,
            EVENT_ON_LOAD,
            EVENT_RECORDING_STATE,
            EVENT_ON_SNAPSHOT
    })

    @interface VideoEvents {
    }

    void setViewId(int viewId) {
        this.viewId = viewId;
    }

    /**
     * MideaPlayer初始化完毕回调
     */
    void loadStart() {
        WritableMap event = Arguments.createMap();
        receiveEvent(EVENT_LOAD_START, event);
    }
    /**
     * 视频状态改变回调
     * @param map
     */
    void onVideoStateChange(WritableMap map){
        receiveEvent(EVENT_ON_VIDEO_STATE_CHANGE, map);
    }

    void sendEvent(WritableMap map, String event) {
        receiveEvent(event, map);
    }

    private void receiveEvent(@VideoEvents String type, WritableMap event) {
        eventEmitter.receiveEvent(viewId, type, event);
    }

}
