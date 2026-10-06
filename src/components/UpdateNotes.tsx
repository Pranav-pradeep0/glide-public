import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '@/hooks/useTheme';
import { metrics, type } from '@/theme/theme';

/**
 * Release notes come from the GitHub release body, which the release workflow builds
 * from commit subjects and then appends a build-info footer to. Both the update modal
 * and the Settings update card show the same thing, so they share one renderer.
 */
export function formatNotes(notes: string | null): string {
    if (!notes) {return 'No changelog provided.';}

    let normalized = notes
        .replace(/\r\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .trim();

    const dividerIndex = normalized.indexOf('\n---');
    if (dividerIndex !== -1) {
        normalized = normalized.slice(0, dividerIndex).trim();
    }

    const buildInfoIndex = normalized.indexOf('\n**Build Info**');
    if (buildInfoIndex !== -1) {
        normalized = normalized.slice(0, buildInfoIndex).trim();
    }

    return normalized.length > 0 ? normalized : 'No changelog provided.';
}

interface UpdateNotesProps {
    notes: string | null;
    maxHeight?: number;
}

export function UpdateNotes({ notes, maxHeight = 200 }: UpdateNotesProps) {
    const { colors } = useTheme();
    const displayNotes = useMemo(() => formatNotes(notes), [notes]);

    return (
        <View style={styles.block}>
            <Text style={[type.heading, styles.title, { color: colors.text }]}>What's new</Text>
            <ScrollView style={{ maxHeight }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                <Markdown
                    style={{
                        body: { ...type.body, lineHeight: 20, color: colors.textSecondary },
                        heading3: { ...type.heading, color: colors.text, marginVertical: metrics.space.xs },
                        list_item: styles.listItem,
                        bullet_list: styles.list,
                        ordered_list: styles.list,
                    }}
                >
                    {displayNotes}
                </Markdown>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    block: { marginBottom: metrics.space.lg },
    title: { marginBottom: metrics.space.sm },
    list: { marginVertical: metrics.space.xs },
    listItem: { marginBottom: metrics.space.xs },
});
