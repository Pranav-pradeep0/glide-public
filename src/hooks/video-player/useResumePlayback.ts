import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { formatTime } from './types';
import { RECAP_AVAILABLE } from '@/utils/constants';

const RECAP_INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 minutes

interface UseResumePlaybackOptions {
    isNetworkStream: boolean;
    resumePosition: number;
    savedDuration?: number;
    imdbId?: string;
    albumName?: string | null;
    isRecapEligible: boolean;
    recapChecked: boolean;
    recapVisible: boolean;
    isPaused: boolean;
    onPlay: () => void;
    onPause: () => void;
    onSeekToStart: () => void;
    onRecap: () => void;
    onRestartPersist: () => void;
}

export function useResumePlayback({
    isNetworkStream,
    resumePosition,
    savedDuration,
    imdbId,
    albumName,
    isRecapEligible,
    recapChecked,
    recapVisible,
    isPaused,
    onPlay,
    onPause,
    onSeekToStart,
    onRecap,
    onRestartPersist,
}: UseResumePlaybackOptions) {
    const shouldResume = useMemo(() => {
        return !isNetworkStream && !!(resumePosition && resumePosition > 15);
    }, [resumePosition, isNetworkStream]);

    const [resumeModalVisible, setResumeModalVisible] = useState(shouldResume);
    const lastPauseTimeRef = useRef<number | null>(null);

    const resumeModalData = useMemo(() => {
        if (!resumePosition) { return null; }

        const remaining = savedDuration ? Math.max(0, savedDuration - resumePosition) : 0;
        const finishBy = savedDuration
            ? new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : undefined;

        return {
            formattedTime: formatTime(resumePosition),
            remainingTime: savedDuration ? remaining : undefined,
            finishByTime: finishBy,
            showRecap: RECAP_AVAILABLE && !isNetworkStream && resumePosition > 120 && (!!imdbId || !!albumName)
                && (isRecapEligible || !recapChecked),
            recapChecking: !recapChecked,
        };
    }, [resumePosition, savedDuration, imdbId, albumName, isNetworkStream, isRecapEligible, recapChecked]);

    // Inactivity prompt: if paused for > threshold, offer resume/recap
    useEffect(() => {
        if (isPaused) {
            if (!lastPauseTimeRef.current) {
                lastPauseTimeRef.current = Date.now();
            }
        } else {
            if (lastPauseTimeRef.current) {
                const pauseDuration = Date.now() - lastPauseTimeRef.current;
                if (!isNetworkStream && pauseDuration > RECAP_INACTIVITY_THRESHOLD && !resumeModalVisible && !recapVisible) {
                    setResumeModalVisible(true);
                    onPause();
                }
            }
            lastPauseTimeRef.current = null;
        }
    }, [isPaused, resumeModalVisible, recapVisible, isNetworkStream, onPause]);

    const handleResumeModalAction = useCallback((action: 'resume' | 'restart' | 'recap') => {
        if (action === 'resume') {
            setResumeModalVisible(false);
            onPlay();
        } else if (action === 'restart') {
            onRestartPersist();
            setResumeModalVisible(false);
            onSeekToStart();
            onPlay();
        } else if (action === 'recap') {
            onRecap();
        }
    }, [onPlay, onRestartPersist, onSeekToStart, onRecap]);

    return {
        resumeModalVisible,
        setResumeModalVisible,
        resumeModalData,
        handleResumeModalAction,
    };
}
