import { ContentDetector } from './ContentDetector';
import { CommonActions } from '@react-navigation/native';
import { NativeModules } from 'react-native';

export class NavigationService {
    /**
     * Check if the path is a network stream
     */
    static isNetworkStream(videoPath: string): boolean {
        return videoPath.startsWith('http://') ||
            videoPath.startsWith('https://') ||
            videoPath.startsWith('rtsp://') ||
            videoPath.startsWith('rtmp://');
    }

    /**
     * Handles navigation to the video player or details screen based on content type.
     * 
     * @param navigation The navigation object from useNavigation
     * @param videoPath The absolute path to the video file
     * @param extraParams Optional extra parameters to pass to the screens (e.g. videoName, isExternalOpen)
     */
    static async handleVideoNavigation(
        navigation: any,
        videoPath: string,
        extraParams: any = {}
    ) {
        if (!videoPath) {
            console.warn('[NavigationService] No video path provided');
            return;
        }

        // For network streams, always go directly to VideoPlayer (skip PlayerDetail)
        if (this.isNetworkStream(videoPath)) {
            console.log('[NavigationService] Network stream detected, skipping PlayerDetail');
            NativeModules.VideoPlayerModule.startPlayer({
                videoPath,
                videoName: extraParams.videoName || 'Stream',
                playMode: 'normal', // No haptics for streams
                ...extraParams
            });
            return;
        }

        // Use synchronous classification for immediate UI response
        const classification = ContentDetector.classifySync(videoPath);
        console.log('[NavigationService] Classified video:', { path: videoPath, classification });

        const isProfessionalContent =
            classification.contentType === 'movie' ||
            classification.contentType === 'series';

        if (isProfessionalContent) {
            // It's a Movie or TV Show -> Go to Detail Screen (Haptics, Metadata, Subtitles)
            navigation.navigate('PlayerDetail', {
                videoPath,
                videoName: extraParams.videoName,
                ...extraParams
            });
        } else {
            // It's a Home Video / Unknown -> Play Directly
            NativeModules.VideoPlayerModule.startPlayer({
                videoPath,
                videoName: extraParams.videoName,
                ...extraParams
            });
        }
    }
}
