/**
 * Simple utility to categorize sound effects.
 * Legacy utility - the main haptic system uses HapticPatternGenerator.
 */
export function mapSoundToHaptic(soundEffect: string): 'low' | 'medium' | 'high' {
    const normalized = soundEffect.toLowerCase().trim();

    // Strong effects
    if (
        normalized.includes('loud') ||
        normalized.includes('violent') ||
        normalized.includes('intense') ||
        normalized.includes('powerful') ||
        normalized.includes('explosion') ||
        normalized.includes('crash') ||
        normalized.includes('thunder')
    ) {
        return 'high';
    }

    // Light effects
    if (
        normalized.includes('soft') ||
        normalized.includes('quiet') ||
        normalized.includes('gentle') ||
        normalized.includes('subtle') ||
        normalized.includes('breathing') ||
        normalized.includes('footstep')
    ) {
        return 'low';
    }

    // Default to medium
    return 'medium';
}
