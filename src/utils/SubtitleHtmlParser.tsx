// utils/SubtitleHtmlParser.tsx
import React, { useMemo } from 'react';
import { Text, TextStyle, StyleProp, Platform } from 'react-native';
import Animated from 'react-native-reanimated';


/**
 * Represents a parsed text segment with styling information
 */
interface ParsedSegment {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color?: string;
}


/**
 * Represents a style state during parsing
 */
interface StyleState {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color?: string;
}


/**
 * Production-ready HTML parser for subtitle text formatting
 * Supports: <b>, <i>, <u>, <font color="">, and nested combinations
 * Handles: SRT, WebVTT, and ASS subtitle formatting
 */
export class SubtitleHtmlParser {
    /**
     * Parse HTML-formatted subtitle text into styled segments
     * @param html - Raw subtitle text with HTML tags
     * @returns Array of parsed segments with style information
     */
    static parse(html: string): ParsedSegment[] {
        if (!html || typeof html !== 'string') {
            return [];
        }

        const segments: ParsedSegment[] = [];
        const styleStack: StyleState[] = [];
        let currentStyle: StyleState = {
            bold: false,
            italic: false,
            underline: false,
            color: undefined,
        };

        // Normalize line breaks from different formats
        let normalizedText = html
            .replace(/\\N/g, '\n')           // ASS format line breaks
            .replace(/<br\s*\/?>/gi, '\n')   // HTML line breaks
            .replace(/\r\n/g, '\n')          // Windows line breaks
            .replace(/\r/g, '\n');           // Mac line breaks

        // Regular expression to match supported HTML tags
        const tagRegex = /<\/?([biu]|font[^>]*)>/gi;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        // Reset regex index
        tagRegex.lastIndex = 0;

        while ((match = tagRegex.exec(normalizedText)) !== null) {
            // Extract text before the current tag
            if (match.index > lastIndex) {
                const textSegment = normalizedText.substring(lastIndex, match.index);
                if (textSegment) {
                    segments.push({
                        text: textSegment,
                        bold: currentStyle.bold,
                        italic: currentStyle.italic,
                        underline: currentStyle.underline,
                        color: currentStyle.color,
                    });
                }
            }

            const fullTag = match[0];
            const tagName = match[1].toLowerCase();
            const isClosingTag = fullTag.startsWith('</');

            if (isClosingTag) {
                // Restore previous style state from stack
                const previousStyle = styleStack.pop();
                if (previousStyle) {
                    currentStyle = { ...previousStyle };
                }
            } else {
                // Save current style to stack before modifying
                styleStack.push({ ...currentStyle });

                // Apply new style based on tag type
                if (tagName === 'b') {
                    currentStyle.bold = true;
                } else if (tagName === 'i') {
                    currentStyle.italic = true;
                } else if (tagName === 'u') {
                    currentStyle.underline = true;
                } else if (tagName.startsWith('font')) {
                    // Extract color from font tag
                    const colorMatch = fullTag.match(/color\s*=\s*["']?([^"'>]+)["']?/i);
                    if (colorMatch) {
                        currentStyle.color = this.normalizeColor(colorMatch[1]);
                    }
                }
            }

            lastIndex = tagRegex.lastIndex;
        }

        // Add any remaining text after the last tag
        if (lastIndex < normalizedText.length) {
            const remainingText = normalizedText.substring(lastIndex);
            if (remainingText) {
                segments.push({
                    text: remainingText,
                    bold: currentStyle.bold,
                    italic: currentStyle.italic,
                    underline: currentStyle.underline,
                    color: currentStyle.color,
                });
            }
        }

        // If no segments were created (no tags found), return the original text
        if (segments.length === 0 && normalizedText) {
            segments.push({
                text: normalizedText,
                bold: false,
                italic: false,
                underline: false,
            });
        }

        return segments;
    }

    /**
     * Normalize color values to valid React Native format
     * Supports: hex (#FFF, #FFFFFF), named colors, rgb/rgba
     */
    private static normalizeColor(color: string): string {
        if (!color) return '';

        const trimmed = color.trim().toLowerCase();

        // Already valid hex color
        if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) {
            return trimmed;
        }

        // Convert shorthand hex
        if (/^[0-9a-f]{3}$/i.test(trimmed)) {
            return `#${trimmed}`;
        }

        // Handle rgb/rgba (return as-is, React Native supports it)
        if (trimmed.startsWith('rgb')) {
            return trimmed;
        }

        // Named colors - pass through (React Native supports basic named colors)
        return trimmed;
    }

    /**
     * Remove all HTML tags from subtitle text
     * Useful for accessibility or plain text extraction
     */
    static stripTags(html: string): string {
        if (!html || typeof html !== 'string') {
            return '';
        }

        return html
            .replace(/<\/?[^>]+(>|$)/g, '')  // Remove all HTML tags
            .replace(/\\N/g, '\n')           // ASS line breaks
            .replace(/&nbsp;/g, ' ')         // HTML spaces
            .replace(/&amp;/g, '&')          // HTML ampersand
            .replace(/&lt;/g, '<')           // HTML less than
            .replace(/&gt;/g, '>')           // HTML greater than
            .replace(/&quot;/g, '"')         // HTML quote
            .trim();
    }

    /**
     * Check if text contains any HTML formatting tags
     */
    static hasHtmlTags(text: string): boolean {
        if (!text || typeof text !== 'string') {
            return false;
        }
        return /<\/?[biu]|<\/?font[^>]*>/i.test(text);
    }
}


/**
 * Props for FormattedSubtitleText component
 */
interface FormattedSubtitleTextProps {
    text: string;
    baseStyle?: StyleProp<TextStyle>;
    animatedStyle?: any; // Reanimated AnimatedStyle
    maxLines?: number;
}


/**
 * React component that renders formatted subtitle text with animation support
 * Supports nested styling, HTML tags, and Reanimated animated styles
 */
export const FormattedSubtitleText: React.FC<FormattedSubtitleTextProps> = ({
    text,
    baseStyle,
    animatedStyle,
    maxLines = 2,
}) => {
    // Memoize parsed segments for performance
    const segments = useMemo(() => {
        return SubtitleHtmlParser.parse(text);
    }, [text]);

    // If no segments or empty text, render nothing
    if (segments.length === 0) {
        return null;
    }

    // Extract base style properties for fallback
    const baseStyleFlat = StyleSheet.flatten(baseStyle) || {};

    return (
        <Animated.Text
            style={[
                baseStyle,
                animatedStyle, // Animated fontSize will cascade to nested Text
            ]}
            numberOfLines={maxLines}
        >
            {segments.map((segment, index) => {
                // Build segment-specific style
                const segmentStyle: TextStyle = {};

                // CRITICAL: Apply styles explicitly, don't rely on inheritance for these
                if (segment.bold) {
                    segmentStyle.fontWeight = 'bold';
                }

                if (segment.italic) {
                    segmentStyle.fontStyle = 'italic';
                }

                if (segment.underline) {
                    segmentStyle.textDecorationLine = 'underline';
                }

                // Apply custom color if specified
                if (segment.color) {
                    segmentStyle.color = segment.color;
                }

                // For Android: explicitly inherit base color if no segment color
                // fontSize is inherited from parent Animated.Text
                if (Platform.OS === 'android' && !segment.color) {
                    segmentStyle.color = baseStyleFlat.color;
                }

                return (
                    <Text key={`seg-${index}`} style={segmentStyle}>
                        {segment.text}
                    </Text>
                );
            })}
        </Animated.Text>
    );
};


/**
 * Hook for using formatted subtitle text with memoization
 */
export const useFormattedSubtitle = (text: string) => {
    return useMemo(() => {
        return {
            segments: SubtitleHtmlParser.parse(text),
            plainText: SubtitleHtmlParser.stripTags(text),
            hasFormatting: SubtitleHtmlParser.hasHtmlTags(text),
        };
    }, [text]);
};


// Re-export StyleSheet for convenience
import { StyleSheet } from 'react-native';
