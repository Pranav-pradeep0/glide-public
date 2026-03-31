import { createMMKV } from 'react-native-mmkv';

export type UpdateApkCache = {
    version: string;
    path: string;
    fileName: string;
    savedAt: number;
};

const UPDATE_APK_KEY = '@glide_update_apk';

const mmkv = createMMKV({
    id: UPDATE_APK_KEY,
});

export const updateStorage = {
    async load(): Promise<UpdateApkCache | null> {
        try {
            const raw = mmkv.getString(UPDATE_APK_KEY);
            if (!raw) {return null;}
            const parsed = JSON.parse(raw) as UpdateApkCache;
            if (!parsed?.path || !parsed?.version || !parsed?.fileName) {
                return null;
            }
            return parsed;
        } catch (error) {
            console.error('[UpdateStorage] Failed to load cache:', error);
            return null;
        }
    },

    async save(cache: UpdateApkCache): Promise<void> {
        try {
            mmkv.set(UPDATE_APK_KEY, JSON.stringify(cache));
        } catch (error) {
            console.error('[UpdateStorage] Failed to save cache:', error);
        }
    },

    async clear(): Promise<void> {
        try {
            mmkv.remove(UPDATE_APK_KEY);
        } catch (error) {
            console.error('[UpdateStorage] Failed to clear cache:', error);
        }
    },
};
