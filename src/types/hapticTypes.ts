export type HapticCategory = 'oscillating' | 'textured' | 'impact' | 'rhythmic';

export interface HapticPattern {
    id: string;
    category: HapticCategory;
    soundEffect: string;
    duration: number;
    intensity: number; // Base intensity 0-255
    priority: number; // 1 (low) to 10 (high)
    waveform?: {
        timings: number[];
        amplitudes: number[];
        baseIntensity: number;
    };
}

export type HapticPrimitive = 'oscillator' | 'noise' | 'transient' | 'pulse';

export interface HapticBaseProfile {
    primitive: HapticPrimitive;
    baseFreq: number;       // Hz (0.5 to 20)
    baseIntensity: number;  // 0-255
    envelope: {
        attack: number;     // 0-1
        decay: number;      // 0-1
        sustain: number;    // 0-1
        release: number;    // 0-1
    };
    grainSize?: number;     // For noise (ms)
    layers?: HapticLayer[];  // Optional secondary layers for complex sounds
}

export interface HapticLayer extends Omit<HapticBaseProfile, 'layers'> {
    startTimeOffset?: number; // ms offset from cue start
    durationMultiplier?: number; // 0-1 (duration of this layer relative to cue duration)
}

export interface HapticKeyword {
    keyword: string;
    category: HapticCategory;
    priority: number;
    baseProfile?: HapticBaseProfile;
    variations?: string[];
}

export interface HapticMatch {
    keyword: string;
    category: HapticCategory;
    confidence: number;
    priority: number;
}
