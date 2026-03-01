import * as RNFS from '@dr.pogodin/react-native-fs';
import { Platform } from 'react-native';
import SimpleThumbnail from '../../libs/react-native-simple-thumbnail';

class FileServiceClass {
    /**
     * Normalize a path to be safe for use with React Native components and libraries.
     * Handles the messy file:// prefix logic consistently.
     */
    normalizePath(path: string): string {
        if (!path) {return '';}

        // Remove double prefixes if any (common issue)
        let cleanPath = path.replace(/file:\/\/file:\/\//g, 'file://');

        // Ensure single file:// prefix for Android if missing (unless it's a content:// URI)
        if (Platform.OS === 'android' && !cleanPath.startsWith('file://') && !cleanPath.startsWith('content://') && !cleanPath.startsWith('http')) {
            // Check if it's an absolute path before adding prefix
            if (cleanPath.startsWith('/')) {
                cleanPath = `file://${cleanPath}`;
            }
        }

        return cleanPath;
    }

    /**
     * Resolve content:// or ph:// URIs to real file paths
     */
    async resolveToRealPath(uri: string): Promise<string> {
        if (!uri) {return uri;}

        // Normalize multiple file:// prefixes
        let normalizedUri = uri;
        while (normalizedUri.startsWith('file://file://')) {
            normalizedUri = normalizedUri.replace('file://file://', 'file://');
        }

        // Already a file path - return clean path
        if (normalizedUri.startsWith('file://')) {
            return normalizedUri.replace('file://', '');
        }

        // No scheme - assume it's already a real path
        if (!normalizedUri.includes('://')) {return normalizedUri;}

        // Try to resolve content:// or ph:// URIs to real paths
        if (normalizedUri.startsWith('content://') || normalizedUri.startsWith('ph://')) {
            try {
                const realPath = await SimpleThumbnail.getRealPath(normalizedUri);
                if (realPath && realPath.length > 0) {
                    let cleanPath = realPath.replace(/^file:\/\//, '');
                    while (cleanPath.startsWith('file://file://')) {
                        cleanPath = cleanPath.replace('file://file://', '');
                    }
                    return cleanPath;
                }
            } catch (error) {
                console.warn('[FileService] Failed to resolve URI:', error);
            }
        }

        return normalizedUri;
    }

    /**
     * Get a clean filesystem path (without file:// prefix) for use with RNFS
     */
    getCleanPath(path: string): string {
        if (!path) {return '';}
        return path.replace('file://', '');
    }

    /**
     * Check if a file or directory exists
     */
    async exists(path: string): Promise<boolean> {
        try {
            const cleanPath = this.getCleanPath(path);
            return await RNFS.exists(cleanPath);
        } catch (error) {
            console.warn('[FileService] exists check failed:', error);
            return false;
        }
    }

    /**
     * Ensure a directory exists, creating it if necessary
     */
    async ensureDir(path: string): Promise<void> {
        try {
            const cleanPath = this.getCleanPath(path);
            const exists = await RNFS.exists(cleanPath);
            if (!exists) {
                await RNFS.mkdir(cleanPath);
            }
        } catch (error) {
            console.error('[FileService] Failed to ensure directory:', path, error);
            throw error;
        }
    }

    /**
     * Delete a file or directory
     */
    async unlink(path: string): Promise<void> {
        try {
            const cleanPath = this.getCleanPath(path);
            if (await RNFS.exists(cleanPath)) {
                await RNFS.unlink(cleanPath);
            }
        } catch (error) {
            console.warn('[FileService] Failed to unlink:', path, error);
        }
    }

    /**
     * Get file stats (size, modification time, etc.)
     */
    async stat(path: string): Promise<RNFS.StatResultT | null> {
        try {
            const cleanPath = this.getCleanPath(path);
            return await RNFS.stat(cleanPath);
        } catch (error) {
            return null;
        }
    }

    /**
     * Clean subtitle cache directory
     */
    async cleanSubtitleCache(): Promise<void> {
        try {
            const cacheDir = this.getSubtitleCacheDir();
            const exists = await RNFS.exists(cacheDir);
            if (exists) {
                await RNFS.unlink(cacheDir);
            }
            await RNFS.mkdir(cacheDir);
        } catch (error) {
            console.error('[FileService] Failed to clean subtitle cache:', error);
        }
    }

    /**
     * Get the subtitle cache directory path
     */
    getSubtitleCacheDir(): string {
        return `${RNFS.CachesDirectoryPath}/subtitles`;
    }

    /**
     * Write content to a file
     */
    async writeFile(path: string, content: string, encoding: RNFS.EncodingT = 'utf8'): Promise<void> {
        try {
            const cleanPath = this.getCleanPath(path);
            await RNFS.writeFile(cleanPath, content, encoding);
        } catch (error) {
            console.error('[FileService] Failed to write file:', path, error);
            throw error;
        }
    }
}

export const FileService = new FileServiceClass();
