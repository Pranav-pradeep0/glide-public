import React, { forwardRef, useImperativeHandle, useRef } from "react";
import {
    StyleSheet,
    requireNativeComponent,
    UIManager,
    findNodeHandle,
    ViewProps,
    NativeSyntheticEvent,
    ViewStyle,
    StyleProp,
} from "react-native";
// @ts-ignore - resolveAssetSource doesn't have proper types
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";

// Native component type declaration
interface RCTVLCPlayerNativeProps {
    ref?: React.Ref<any>;
    style?: StyleProp<ViewStyle>;
    source?: any;
    src?: any;
    progressUpdateInterval?: number;
    paused?: boolean;
    rate?: number;
    seek?: number;
    resume?: boolean;
    muted?: boolean;
    repeat?: boolean;
    volume?: number;
    audioTrack?: number;
    textTrack?: number;
    resizeMode?: string;
    playInBackground?: boolean;
    autoAspectRatio?: boolean;
    videoAspectRatio?: string;
    audioEqualizer?: number[];
    audioDelay?: number;
    title?: string;
    artist?: string;
    onVideoLoadStart?: (event: any) => void;
    onVideoOpen?: (event: any) => void;
    onVideoError?: (event: any) => void;
    onVideoProgress?: (event: any) => void;
    onVideoEnded?: (event: any) => void;
    onVideoEnd?: (event: any) => void;
    onVideoPlaying?: (event: any) => void;
    onVideoPaused?: (event: any) => void;
    onVideoStopped?: (event: any) => void;
    onVideoBuffering?: (event: any) => void;
    onVideoLoad?: (event: any) => void;
    onRecordingState?: (event: any) => void;
    onSnapshot?: (event: any) => void;
    onVideoSeek?: (event: any) => void;
    [key: string]: any;
}

const RCTVLCPlayer = requireNativeComponent<RCTVLCPlayerNativeProps>("RCTVLCPlayer") as unknown as React.ComponentType<RCTVLCPlayerNativeProps>;

export type VLCPlayerResizeMode =
    "contain" | "cover" | "fill" | "stretch" | "none" | "scale-down" | "best-fit" | "center";
export type VLCPlayerAudioTrack = { id: number; name: string };
export type VLCPlayerTextTrack = { id: number; name: string };

export interface VLCPlayerSource {
    uri?: string;
    isNetwork?: boolean;
    isAsset?: boolean;
    type?: string;
    mainVer?: number;
    patchVer?: number;
    initOptions?: string[];
    [key: string]: any;
}

export interface VLCPlayerProps extends ViewProps {
    /* Native only */
    rate?: number;
    seek?: number;
    resume?: boolean;
    paused?: boolean;
    autoAspectRatio?: boolean;
    videoAspectRatio?: string;
    volume?: number;
    disableFocus?: boolean;
    src?: any; // Internal use
    source?: any;
    playInBackground?: boolean;
    playWhenInactive?: boolean;
    resizeMode?: string;
    poster?: string;
    repeat?: boolean;
    muted?: boolean;
    audioTrack?: number;
    textTrack?: number;
    acceptInvalidCertificates?: boolean;
    autoplay?: boolean;
    subtitleUri?: string;
    audioEqualizer?: number[];
    audioDelay?: number;
    title?: string;
    artist?: string;

    /* Callbacks */
    onVideoLoadStart?: (event: any) => void;
    onVideoError?: (event: any) => void;
    onVideoProgress?: (event: any) => void;
    onVideoEnded?: (event: any) => void;
    onVideoPlaying?: (event: any) => void;
    onVideoPaused?: (event: any) => void;
    onVideoStopped?: (event: any) => void;
    onVideoBuffering?: (event: any) => void;
    onVideoOpen?: (event: any) => void;
    onVideoLoad?: (event: any) => void;
    onVideoSeek?: (event: any) => void;
    onRecordingState?: (event: any) => void;
    onSnapshot?: (event: any) => void;

    /* Wrapper callbacks */
    onLoadStart?: (event: any) => void;
    onError?: (event: any) => void;
    onProgress?: (event: any) => void;
    onEnded?: (event: any) => void; // Legacy alias: onEnd
    onEnd?: (event: any) => void;
    onStopped?: (event: any) => void;
    onPlaying?: (event: any) => void;
    onPaused?: (event: any) => void;
    onRecordingCreated?: (path: string) => void;
    onBuffering?: (event: any) => void;
    onOpen?: (event: any) => void;
    onLoad?: (event: any) => void;
    onSeek?: (event: any) => void;
}

export interface VLCPlayerRef {
    seek: (pos: number) => void;
    resume: (isResume: boolean) => void;
    snapshot: (path: string) => void;
    startRecording: (path: string) => void;
    stopRecording: () => void;
    stopPlayer: () => void;
    pausePlayer: () => void; // Added for completeness
    setNativeProps: (nativeProps: any) => void;
    changeVideoAspectRatio: (ratio: string) => void;
    autoAspectRatio: (isAuto: boolean) => void;
    setVolume: (vol: number) => void;
}

const VLCPlayer = forwardRef<VLCPlayerRef, VLCPlayerProps>((props, ref) => {
    const nativeComponentRef = useRef<any>(null);
    const lastRecordingRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
        seek: (pos: number) => {
            setNativeProps({ seek: pos });
        },
        resume: (isResume: boolean) => {
            setNativeProps({ resume: isResume });
        },
        snapshot: (path: string) => {
            dispatchCommand("snapshot", [path]);
        },
        startRecording: (path: string) => {
            dispatchCommand("startRecording", [path]);
        },
        stopRecording: () => {
            dispatchCommand("stopRecording", []);
        },
        stopPlayer: () => {
            dispatchCommand("stopPlayer", []);
        },
        pausePlayer: () => {
            dispatchCommand("pausePlayer", []);
        },
        setNativeProps: (nativeProps: any) => {
            setNativeProps(nativeProps);
        },
        changeVideoAspectRatio: (ratio: string) => {
            setNativeProps({ videoAspectRatio: ratio });
        },
        autoAspectRatio: (isAuto: boolean) => {
            setNativeProps({ autoAspectRatio: isAuto });
        },
        setVolume: (vol: number) => {
            setNativeProps({ volume: vol });
        },
    }));

    const setNativeProps = (nativeProps: any) => {
        if (nativeComponentRef.current) {
            nativeComponentRef.current.setNativeProps(nativeProps);
        }
    };

    const dispatchCommand = (command: string, args: any[]) => {
        if (nativeComponentRef.current) {
            UIManager.dispatchViewManagerCommand(
                findNodeHandle(nativeComponentRef.current),
                UIManager.getViewManagerConfig("RCTVLCPlayer").Commands[command],
                args
            );
        }
    };

    // Callback wrappers
    const _onBuffering = (event: NativeSyntheticEvent<any>) => {
        props.onBuffering?.(event.nativeEvent);
    };

    const _onError = (event: NativeSyntheticEvent<any>) => {
        props.onError?.(event.nativeEvent);
    };

    const _onOpen = (event: NativeSyntheticEvent<any>) => {
        props.onOpen?.(event.nativeEvent);
    };

    const _onLoadStart = (event: NativeSyntheticEvent<any>) => {
        props.onLoadStart?.(event.nativeEvent);
    };

    const _onProgress = (event: NativeSyntheticEvent<any>) => {
        props.onProgress?.(event.nativeEvent);
    };

    const _onEnded = (event: NativeSyntheticEvent<any>) => {
        props.onEnd?.(event.nativeEvent);
    };

    const _onStopped = () => {
        props.onStopped?.({});
    };

    const _onPaused = (event: NativeSyntheticEvent<any>) => {
        props.onPaused?.(event.nativeEvent);
    };

    const _onPlaying = (event: NativeSyntheticEvent<any>) => {
        props.onPlaying?.(event.nativeEvent);
    };

    const _onLoad = (event: NativeSyntheticEvent<any>) => {
        props.onLoad?.(event.nativeEvent);
    };

    const _onRecordingState = (event: NativeSyntheticEvent<any>) => {
        if (lastRecordingRef.current === event.nativeEvent.recordPath) {
            return;
        }
        if (!event.nativeEvent.isRecording && event.nativeEvent.recordPath) {
            lastRecordingRef.current = event.nativeEvent.recordPath;
            props.onRecordingCreated?.(lastRecordingRef.current!);
        }
    };

    const _onSnapshot = (event: NativeSyntheticEvent<any>) => {
        if (event.nativeEvent.success) {
            props.onSnapshot?.(event.nativeEvent);
        }
    };

    const _onSeek = (event: NativeSyntheticEvent<any>) => {
        props.onSeek?.(event.nativeEvent);
    };

    // Render logic
    const source = resolveAssetSource(props.source) || {};
    let uri = source.uri || "";
    if (uri && uri.match(/^\//)) {
        uri = `file://${uri}`;
    }

    let isNetwork = !!(uri && uri.match(/^https?:/));
    const isAsset = !!(uri && uri.match(/^(assets-library|file|content|ms-appx|ms-appdata):/));
    if (!isAsset) {
        isNetwork = true;
    }
    if (uri && uri.match(/^\//)) {
        isNetwork = false;
    }

    const src = {
        uri,
        isNetwork,
        isAsset,
        type: source.type || "",
        mainVer: source.mainVer || 0,
        patchVer: source.patchVer || 0,
    };

    const nativeProps = {
        ...props,
        style: [styles.base, props.style],
        source: {
            ...source,
            initOptions: source.initOptions || [],
            isNetwork,
            autoplay: props.autoplay ?? true,
        },
        src: src,
        progressUpdateInterval: props.onProgress ? 250 : 0,
    };

    return (
        <RCTVLCPlayer
            ref={nativeComponentRef}
            {...nativeProps}
            onVideoLoadStart={_onLoadStart}
            onVideoOpen={_onOpen}
            onVideoError={_onError}
            onVideoProgress={_onProgress}
            onVideoEnded={_onEnded}
            onVideoEnd={_onEnded}
            onVideoPlaying={_onPlaying}
            onVideoPaused={_onPaused}
            onVideoStopped={_onStopped}
            onVideoBuffering={_onBuffering}
            onVideoLoad={_onLoad}
            onRecordingState={_onRecordingState}
            onSnapshot={_onSnapshot}
            onVideoSeek={_onSeek}
        />
    );
});

const styles = StyleSheet.create({
    base: {
        overflow: "hidden",
    },
});

export default VLCPlayer;
