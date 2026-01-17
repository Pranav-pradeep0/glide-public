// src/theme/colors.ts

export const lightColors = {
    primary: '#000000',
    secondary: '#333333',
    background: '#FFFFFF',
    surface: '#F9FAFB',
    surfaceVariant: '#F3F4F6', // Slightly darker than surface
    text: '#000000',
    textSecondary: '#6B7280',
    border: '#E5E7EB',
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
    card: '#FFFFFF',
    cardElevated: '#FFFFFF', // For bottom sheet
    shadow: '#000000',
};

export const darkColors = {
    primary: '#FFFFFF',
    secondary: '#CCCCCC',
    background: '#000000', // Pure black
    surface: '#1A1A1A', // Dark gray
    surfaceVariant: '#2A2A2A', // Slightly lighter than surface
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    border: '#2A2A2A',
    error: '#F87171',
    success: '#34D399',
    warning: '#FBBF24',
    card: '#1A1A1A', // Dark gray
    cardElevated: '#242424', // Elevated for bottom sheet
    shadow: '#000000',
};

export type ColorScheme = typeof lightColors;
