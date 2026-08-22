import { PermissionsAndroid, Platform } from 'react-native';

class PermissionServiceClass {
    /**
     * Check and request necessary storage/media permissions on Android.
     * Returns true if permissions are granted or not required (iOS).
     */
    async hasAndroidPermission(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }

        try {
            // Android 13+ (API 33+) uses granular media permissions
            if (Platform.Version >= 33) {
                const statuses = await PermissionsAndroid.requestMultiple([
                    PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
                    PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
                ]);

                return (
                    statuses[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES] === PermissionsAndroid.RESULTS.GRANTED &&
                    statuses[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO] === PermissionsAndroid.RESULTS.GRANTED
                );
            }

            // Android 12 and below use READ_EXTERNAL_STORAGE
            const status = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
            );
            return status === PermissionsAndroid.RESULTS.GRANTED;

        } catch (error) {
            console.error('[PermissionService] Permission request failed:', error);
            return false;
        }
    }

    /**
     * Request POST_NOTIFICATIONS (Android 13+). Without it the native player
     * silently skips the media notification, so background playback has no
     * lockscreen or notification controls.
     */
    async hasNotificationPermission(): Promise<boolean> {
        if (Platform.OS !== 'android' || Platform.Version < 33) {
            return true;
        }

        try {
            const status = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
            );
            return status === PermissionsAndroid.RESULTS.GRANTED;
        } catch (error) {
            console.error('[PermissionService] Notification permission request failed:', error);
            return false;
        }
    }
}

export const PermissionService = new PermissionServiceClass();
