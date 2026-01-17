import { useState, useEffect } from 'react';
import { ThumbnailService } from '@/services/ThumbnailService';

export function useThumbnail(videoPath: string | undefined, duration: number = 0) {
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let isMounted = true;

        if (!videoPath) {
            setThumbnail(null);
            return;
        }

        setThumbnail(null);

        const fetchThumbnail = async () => {
            setLoading(true);
            try {
                const thumb = await ThumbnailService.getThumbnail(videoPath);
                if (isMounted) {
                    setThumbnail(thumb);
                }
            } catch (error) {
                console.error('Failed to load thumbnail:', error);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        fetchThumbnail();

        return () => {
            isMounted = false;
            if (videoPath) {
                ThumbnailService.cancelRequest(videoPath, duration || 0);
            }
        };
    }, [videoPath, duration]);

    return { thumbnail, loading };
}
