import { Linking, Platform } from 'react-native';
import { FileService } from './FileService';

const LOG_PREFIX = '[DeepLinkService]';

export class DeepLinkService {
    /**
     * Check if a URI looks like a video file
     */
    static isVideoUri(uri: string): boolean {
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.mpg', '.mpeg', '.m3u8'];
        const lowerUri = uri.toLowerCase();

        // Check by extension (works for all URI types)
        if (videoExtensions.some(ext => lowerUri.includes(ext))) {
            return true;
        }

        // Check if content:// URI (usually videos from file managers)
        // We trust the intent filter already validated this is a video
        if (uri.startsWith('content://')) {
            return true;
        }

        // Check if HTTP/HTTPS URL - trust that intent filter validated it
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            return true;
        }

        return false;
    }

    /**
     * Extract video name from URI
     */
    static getVideoNameFromUri(uri: string): string {
        try {
            // Handle HTTP/HTTPS URLs
            if (uri.startsWith('http://') || uri.startsWith('https://')) {
                try {
                    const url = new URL(uri);
                    const pathname = url.pathname;
                    const parts = pathname.split('/');
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart.includes('.')) {
                        return decodeURIComponent(lastPart.split('?')[0]);
                    }
                    // For HLS streams or URLs without filename
                    return url.hostname || 'Stream';
                } catch {
                    return 'Stream';
                }
            }

            // Handle content:// URIs
            if (uri.startsWith('content://')) {
                // Try to extract filename from path component
                const parts = uri.split('/');
                const lastPart = parts[parts.length - 1];
                // Decode URI component and remove query params
                const decoded = decodeURIComponent(lastPart.split('?')[0]);
                if (decoded && decoded.includes('.')) {
                    return decoded;
                }
                // Try to get display name from document pattern
                // content://com.android.externalstorage.documents/document/primary%3ADownload%2Fvideo.mp4
                const docMatch = uri.match(/document\/[^%]+%3A(.+)/);
                if (docMatch) {
                    const decodedPath = decodeURIComponent(docMatch[1]);
                    const segments = decodedPath.split('%2F').join('/').split('/');
                    return segments[segments.length - 1] || 'External Video';
                }
                return 'External Video';
            }

            // Handle file:// URIs and regular paths
            const cleanPath = uri.replace('file://', '');
            const parts = cleanPath.split('/');
            return decodeURIComponent(parts[parts.length - 1]);
        } catch (error) {
            console.error(LOG_PREFIX, 'Error extracting video name:', error);
            return 'Video';
        }
    }

    /**
     * Resolve content:// URI to a real file:// path
     * Returns the original URI if resolution fails
     */
    static async resolveToFilePath(uri: string): Promise<string> {
        console.log(LOG_PREFIX, 'Resolving URI:', uri);

        // HTTP/HTTPS URLs - pass through directly for streaming
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            console.log(LOG_PREFIX, 'HTTP(S) stream URL, passing through');
            return uri;
        }

        // Already a file:// path or regular path
        if (uri.startsWith('file://') || !uri.includes('://')) {
            console.log(LOG_PREFIX, 'Already a file path, returning as-is');
            return uri;
        }

        // Try to resolve content:// URI to real path
        if (Platform.OS === 'android' && uri.startsWith('content://')) {
            try {
                const realPath = await FileService.resolveToRealPath(uri);

                if (realPath && realPath !== uri && !realPath.startsWith('content://')) {
                    // Add file:// prefix if it's a clean path
                    const filePath = realPath.startsWith('/') ? `file://${realPath}` : realPath;
                    console.log(LOG_PREFIX, 'Resolved to file path:', filePath);
                    return filePath;
                }
            } catch (error) {
                console.warn(LOG_PREFIX, 'Failed to resolve content:// URI:', error);
            }
        }

        // Fallback: return original URI
        console.log(LOG_PREFIX, 'Could not resolve, returning original URI');
        return uri;
    }

    /**
     * Get the initial URL that launched the app
     */
    static async getInitialUrl(): Promise<string | null> {
        try {
            const url = await Linking.getInitialURL();
            console.log(LOG_PREFIX, 'Initial URL:', url);
            return url;
        } catch (error) {
            console.error(LOG_PREFIX, 'Error getting initial URL:', error);
            return null;
        }
    }

    /**
     * Subscribe to URL events (for when app is already running)
     */
    static addUrlListener(callback: (url: string) => void): () => void {
        const subscription = Linking.addEventListener('url', (event) => {
            console.log(LOG_PREFIX, 'URL event received:', event.url);
            callback(event.url);
        });

        return () => subscription.remove();
    }
}
