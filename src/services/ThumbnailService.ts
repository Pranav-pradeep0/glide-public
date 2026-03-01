import SimpleThumbnail from '../../libs/react-native-simple-thumbnail';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { FileService } from './FileService';

const THUMBNAIL_DIR = `${RNFS.CachesDirectoryPath}/thumbnails`;
const MAX_CONCURRENT_WORKERS = 4;

interface PendingRequest {
    resolve: (path: string | null) => void;
    reject: (error: any) => void;
}

interface TaskItem {
    path: string;
    time: number;
    key: string;
}

class ThumbnailServiceClass {
    // LIFO Queue of TaskItems
    private queue: TaskItem[] = [];
    private activeWorkers = 0;

    // Map using unique key (path + time) to deduplicate requests
    private pendingResolvers = new Map<string, PendingRequest[]>();

    // Set of currently processing keys
    private processingKeys = new Set<string>();

    constructor() {
        this.init();
    }

    private async init() {
        await FileService.ensureDir(THUMBNAIL_DIR);
    }

    /**
     * Get a thumbnail for a video at a specific time.
     * @param videoPath Absolute path or content:// URI
     * @param timeMs Time in milliseconds (0 = Smart Scan)
     */
    async getThumbnail(videoPath: string, timeMs: number = 0): Promise<string | null> {
        if (!videoPath) { return null; }

        // Create a unique key for this request (path + time)
        const key = `${videoPath}::${timeMs}`;
        const filename = `${this.hashPath(key)}.jpg`;
        const outPath = `${THUMBNAIL_DIR}/${filename}`;

        // 1. Check Disk Cache
        if (await FileService.exists(outPath)) {
            return `file://${outPath}`;
        }

        // 2. Queue for Generation
        return new Promise((resolve, reject) => {
            // Deduplication
            if (this.pendingResolvers.has(key)) {
                this.pendingResolvers.get(key)?.push({ resolve, reject });
                this.promoteToTop(key);
                return;
            }

            // New Request
            this.pendingResolvers.set(key, [{ resolve, reject }]);
            this.queue.push({ path: videoPath, time: timeMs, key });
            this.processNext();
        });
    }

    /**
     * Cancel a request
     */
    cancelRequest(videoPath: string, timeMs: number = 0) {
        const key = `${videoPath}::${timeMs}`;
        const index = this.queue.findIndex(item => item.key === key);
        if (index !== -1) {
            this.queue.splice(index, 1);
            this.pendingResolvers.delete(key);
        }
    }

    private promoteToTop(key: string) {
        const index = this.queue.findIndex(item => item.key === key);
        if (index !== -1) {
            const item = this.queue.splice(index, 1)[0];
            this.queue.push(item);
        }
    }

    private async processNext() {
        if (this.activeWorkers >= MAX_CONCURRENT_WORKERS || this.queue.length === 0) {
            return;
        }

        // LIFO: Take the LAST item
        const task = this.queue.pop();
        if (!task) { return; }

        this.activeWorkers++;
        this.processingKeys.add(task.key);

        const filename = `${this.hashPath(task.key)}.jpg`;
        const outPath = `${THUMBNAIL_DIR}/${filename}`;

        try {
            // Resolve content:// URIs
            let resolvedPath = task.path;
            if (task.path.startsWith('content://')) {
                try {
                    resolvedPath = await FileService.resolveToRealPath(task.path);
                } catch (e) {
                    // Ignore, try original
                }
            }

            const result = await SimpleThumbnail.generate({
                source: resolvedPath,
                dest: `file://${outPath}`,
                time: task.time,
                width: 320,
                quality: 60,
            });

            const finalPath = result?.path ? result.path : null;

            // Notify all waiters
            const waiters = this.pendingResolvers.get(task.key);
            if (waiters) {
                waiters.forEach(w => w.resolve(finalPath));
                this.pendingResolvers.delete(task.key);
            }

        } catch (error) {
            console.error('[ThumbnailService] Error:', error);
            const waiters = this.pendingResolvers.get(task.key);
            if (waiters) {
                waiters.forEach(w => w.resolve(null));
                this.pendingResolvers.delete(task.key);
            }
        } finally {
            this.activeWorkers--;
            this.processingKeys.delete(task.key);
            this.processNext();
        }
    }

    private hashPath(path: string): string {
        let hash = 0;
        for (let i = 0; i < path.length; i++) {
            // eslint-disable-next-line no-bitwise
            hash = (hash << 5) - hash + path.charCodeAt(i);
            // eslint-disable-next-line no-bitwise
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
}

export const ThumbnailService = new ThumbnailServiceClass();
