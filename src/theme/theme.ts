// src/theme/themes.ts

import { lightColors, darkColors, ColorScheme } from './colors';

export interface Theme {
    dark: boolean;
    colors: ColorScheme;
    spacing: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };
    borderRadius: {
        sm: number;
        md: number;
        lg: number;
        full: number;
    };
    typography: {
        small: number;
        regular: number;
        medium: number;
        large: number;
        xlarge: number;
    };
}

const commonTheme = {
    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
    },
    borderRadius: {
        sm: 4,
        md: 8,
        lg: 12,
        full: 9999,
    },
    typography: {
        small: 12,
        regular: 14,
        medium: 16,
        large: 18,
        xlarge: 24,
    },
};

export const lightTheme: Theme = {
    dark: false,
    colors: lightColors,
    ...commonTheme,
};

export const darkTheme: Theme = {
    dark: true,
    colors: darkColors,
    ...commonTheme,
};
