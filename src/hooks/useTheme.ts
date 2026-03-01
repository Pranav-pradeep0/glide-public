import { useAppStore } from '../store/appStore';
import { darkTheme, lightTheme, Theme } from '@/theme/theme';

export function useTheme(): Theme {
    const { settings } = useAppStore();
    return settings.darkMode ? darkTheme : lightTheme;
}
