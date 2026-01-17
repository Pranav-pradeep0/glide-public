import { HapticContext } from './ContextAnalyzer';
import { HapticBaseProfile, HapticPrimitive } from '../types/hapticTypes';

export class HapticSynthesizer {
    private static readonly STEP_MS = 40; // Resolution of the waveform

    /**
     * Synthesizes a waveform based on a profile and context
     */
    static synthesize(
        profile: HapticBaseProfile,
        context: HapticContext,
        durationMs: number
    ): { timings: number[]; amplitudes: number[] } {
        const steps = Math.ceil(durationMs / this.STEP_MS);
        const timings: number[] = new Array(steps).fill(this.STEP_MS);
        const accumulatedAmplitudes: number[] = new Array(steps).fill(0);

        // Treat the base profile as a layer if no explicit layers are defined
        const layers = profile.layers && profile.layers.length > 0
            ? profile.layers
            : [profile as any]; // Casting to treat base profile as a layer

        for (const layer of layers) {
            const layerDuration = durationMs * (layer.durationMultiplier || 1.0);
            const offsetSteps = Math.floor((layer.startTimeOffset || 0) / this.STEP_MS);
            const layerSteps = Math.ceil(layerDuration / this.STEP_MS);

            // Apply Speed Multiplier to Frequency
            const freq = layer.baseFreq * context.speedMultiplier;

            // Apply Intensity Multiplier (Context-aware volume)
            let intensity = layer.baseIntensity * context.intensityMultiplier * 0.8;
            intensity = Math.min(255, Math.max(1, intensity));

            // Generate Sample Generation Function
            const generator = this.getGenerator(layer.primitive, layer);

            for (let i = 0; i < layerSteps; i++) {
                const stepIndex = offsetSteps + i;
                if (stepIndex >= steps) break;

                const time = i * this.STEP_MS;
                const progress = i / layerSteps;

                // 1. Base Signal
                let sample = generator(time, freq, layer);

                // 2. Apply Texture/Roughness (Jitter)
                if (context.roughness > 0) {
                    const jitter = (Math.random() - 0.5) * 2 * context.roughness;
                    sample *= (1 + jitter);
                }

                // 3. Apply Tremolo (LFO) for "Shaky" feel
                if (context.roughness > 0.5) {
                    const lfoFreq = 5; // 5Hz tremor
                    const lfo = Math.sin(time / 1000 * Math.PI * 2 * lfoFreq);
                    const depth = (context.roughness - 0.5) * 0.5;
                    sample *= (1 + lfo * depth);
                }

                // 4. Apply ADSR Envelope
                const adjAttack = layer.envelope.attack / (context.sharpness * 1.5 + 0.1);
                const envValue = this.calculateEnvelope(progress, {
                    ...layer.envelope,
                    attack: Math.min(0.4, adjAttack)
                });
                sample *= envValue;

                // Sum this layer's contribution
                accumulatedAmplitudes[stepIndex] += (sample * intensity);
            }
        }

        // Clamp and finalize amplitudes
        const amplitudes = accumulatedAmplitudes.map(amp =>
            Math.min(255, Math.max(0, Math.floor(amp)))
        );

        return { timings, amplitudes };
    }

    private static getGenerator(
        type: HapticPrimitive,
        profile: HapticBaseProfile
    ): (time: number, freq: number, p: HapticBaseProfile) => number {
        switch (type) {
            case 'oscillator':
                return (t, f) => 0.5 + 0.5 * Math.sin((t / 1000) * Math.PI * 2 * f);

            case 'pulse':
                return (t, f) => {
                    const period = 1000 / f;
                    const phase = (t % period) / period;
                    // Softer pulse edge (squared sine) for a "thump" rather than "click"
                    return phase < 0.2 ? Math.pow(Math.sin(phase * 5 * Math.PI), 2) : 0.0;
                };

            case 'noise':
                // Pink Noise approximation (1/f) for deeper rumble
                // Averaging white noise samples to filter out high frequencies
                let b0 = 0, b1 = 0, b2 = 0;
                return () => {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    const pink = (b0 + b1 + b2 + white * 0.5362) * 0.11;
                    return (pink + 1) / 2; // Normalize to 0-1
                };

            case 'transient':
                // Exponential decay for natural impact
                return (t) => t < 50 ? Math.exp(-t * 0.1) : 0.0;

            default:
                return () => 0;
        }
    }

    private static calculateEnvelope(
        p: number,
        env: { attack: number; decay: number; sustain: number; release: number }
    ): number {
        // Attack
        if (p < env.attack) {
            return p / env.attack;
        }
        // Decay
        if (p < env.attack + env.decay) {
            const decayP = (p - env.attack) / env.decay;
            return 1.0 - decayP * (1.0 - env.sustain);
        }
        // Sustain
        if (p < 1.0 - env.release) {
            return env.sustain;
        }
        // Release
        const releaseP = (p - (1.0 - env.release)) / env.release;
        return env.sustain * (1.0 - releaseP);
    }
}
