// components/Loader.tsx
import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

interface LoaderProps {
    size?: 'small' | 'medium' | 'large';
    text?: string;
    fullScreen?: boolean;
}

export function Loader({ size = 'medium', text, fullScreen = false }: LoaderProps) {
    const theme = useTheme();

    const sizes = {
        small: { spinner: 24, dot: 8, container: 40 },
        medium: { spinner: 36, dot: 12, container: 60 },
        large: { spinner: 48, dot: 16, container: 80 },
    };

    const currentSize = sizes[size];

    const containerStyle = fullScreen
        ? [styles.fullScreenContainer, { backgroundColor: theme.colors.background }]
        : styles.inlineContainer;

    return (
        <View style={containerStyle}>
            <View style={styles.loaderContent}>
                <ActivityIndicator size={size === 'small' ? 'small' : 'large'} color={theme.colors.primary} />
                {text && (
                    <Text style={[styles.loaderText, { color: theme.colors.textSecondary, fontSize: size === 'small' ? 12 : 14 }]}>
                        {text}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    fullScreenContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    inlineContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loaderContent: {
        alignItems: 'center',
        gap: 12,
    },
    loaderText: {
        textAlign: 'center',
        marginTop: 8,
    },
});
