import { PermissionsAndroid, Platform } from 'react-native';

class PermissionServiceClass {
    /**
     * Check and request the video permission Glide actually reads on Android.
     * Returns true if it is granted or not required (iOS).
     */
    async hasAndroidPermission(): Promise<boolean> {
        if (Platform.OS !== 'android') {
            return true;
        }

        try {
            // Android 13+ (API 33+) uses granular media permissions. Glide reads only
            // videos, so it must not ask for images or audio to get at them.
            //
            // On Android 14+ "Select videos" grants partial access. Glide does not
            // declare READ_MEDIA_VISUAL_USER_SELECTED and so runs in compatibility
            // mode: the grant reads as granted but covers only the chosen videos, and
            // the picker reappears on a later launch. Declaring it would mean owning
            // re-selection UI, which is not worth it until users ask.
            if (Platform.Version >= 33) {
                const status = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO
                );
                return status === PermissionsAndroid.RESULTS.GRANTED;
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

}

export const PermissionService = new PermissionServiceClass();
