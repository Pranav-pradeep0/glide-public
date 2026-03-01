import nlp from 'compromise';
import Sentiment from 'sentiment';

export interface HapticContext {
    intensityMultiplier: number; // 0.5 to 2.0 (Default 1.0)
    speedMultiplier: number;     // 0.5 to 2.0 (Default 1.0)
    roughness: number;           // 0.0 to 1.0 (Texture)
    sharpness: number;           // 0.0 to 1.0 (Attack speed)
    sentimentScore: number;      // -5 to +5
    modifiers: string[];         // Detected adjectives
}

export class ContextAnalyzer {
    private static sentiment = new Sentiment();

    /**
     * Maps textual modifiers to physical haptic parameters
     */
    private static readonly MODIFIER_MAP: Record<string, Partial<HapticContext>> = {
        // ... (existing modifiers) ...
        heavy: { intensityMultiplier: 1.5, speedMultiplier: 0.9, roughness: 0.6 },
        hard: { intensityMultiplier: 1.4, sharpness: 0.8 },
        violent: { intensityMultiplier: 1.8, roughness: 0.9, speedMultiplier: 1.2 },
        soft: { intensityMultiplier: 0.6, sharpness: 0.2 },
        faint: { intensityMultiplier: 0.4, roughness: 0.1 },
        light: { intensityMultiplier: 0.6, sharpness: 0.3 },
        fast: { speedMultiplier: 1.5 },
        rapid: { speedMultiplier: 1.7, sharpness: 0.7 },
        slow: { speedMultiplier: 0.6 },
        steady: { speedMultiplier: 1.0 },
        frantic: { speedMultiplier: 1.8, roughness: 0.5 },
        shaky: { roughness: 0.8 },
        coarse: { roughness: 0.9 },
        smooth: { roughness: 0.0 },
        raspy: { roughness: 0.7 },
        distant: { intensityMultiplier: 0.5, sharpness: 0.1, roughness: 0.2 },
        muffled: { sharpness: 0.1, roughness: 0.3 },
        sharp: { sharpness: 1.0 },
    };

    /**
     * Maps verbs to speed dynamics
     */
    private static readonly VERB_MAP: Record<string, Partial<HapticContext>> = {
        run: { speedMultiplier: 1.8 },
        walk: { speedMultiplier: 1.0 },
        crawl: { speedMultiplier: 0.5 },
        sprint: { speedMultiplier: 2.0, intensityMultiplier: 1.2 },
        limp: { speedMultiplier: 0.7, roughness: 0.3 },
        dash: { speedMultiplier: 1.9 },
        stumble: { speedMultiplier: 0.8, roughness: 0.5 },
    };

    /**
     * Maps spatial keywords to proximity effects
     */
    private static readonly SPATIAL_MAP: Record<string, Partial<HapticContext>> = {
        distance: { intensityMultiplier: 0.4, sharpness: 0.1, roughness: 0.2 },
        far: { intensityMultiplier: 0.3, sharpness: 0.05 },
        away: { intensityMultiplier: 0.6 },
        nearby: { intensityMultiplier: 1.2, sharpness: 0.8 },
        close: { intensityMultiplier: 1.3, sharpness: 0.9 },
    };

    /**
     * Analyzes the context of a sound effect
     * @param text The full subtitle text (e.g., "[Heavy breathing]")
     * @param keyword The detected sound keyword (e.g., "breathing")
     */
    static analyze(text: string, keyword: string): HapticContext {
        // 1. Clean terms
        const cleanText = text.replace(/[\[\]\(\)]/g, '').toLowerCase();

        // 2. Analyze Sentiment
        const sentimentResult = this.sentiment.analyze(cleanText);

        // 3. Extract Features using NLP
        const doc = nlp(cleanText);
        const adjectives = doc.adjectives().out('array');
        const verbs = doc.verbs().out('array');

        // 4. Calculate Parameters
        let context: HapticContext = {
            intensityMultiplier: 1.0,
            speedMultiplier: 1.0,
            roughness: 0.0,
            sharpness: 0.5,
            sentimentScore: sentimentResult.score,
            modifiers: adjectives,
        };

        // Apply Modifiers (Adjectives)
        adjectives.forEach((adj: string) => {
            const mapped = this.MODIFIER_MAP[adj];
            if (mapped) {this.applyToContext(context, mapped);}
        });

        // Apply Verbs (Dynamics)
        verbs.forEach((v: string) => {
            // Check for direct match or root form
            const normalizedVerb = v.toLowerCase();
            const mapped = this.VERB_MAP[normalizedVerb] ||
                this.VERB_MAP[nlp(normalizedVerb).verbs().toInfinitive().out('text')];
            if (mapped) {this.applyToContext(context, mapped);}
        });

        // Apply Spatial Clues (Proximity)
        Object.keys(this.SPATIAL_MAP).forEach(key => {
            if (cleanText.includes(key)) {
                this.applyToContext(context, this.SPATIAL_MAP[key]);
            }
        });

        // 5. Apply Sentiment Influence
        const tension = Math.abs(sentimentResult.score);
        if (tension > 2) {
            context.intensityMultiplier *= (1 + (tension * 0.05));
        }

        // 6. Debug Log (Verification)
        if (__DEV__) {
            if (__DEV__) {console.log(`[HapticAI] 🧠 Analyzing "${text}"`);}
            if (__DEV__) {console.log(`   └─ Sentiment: ${sentimentResult.score}`);}
            if (__DEV__) {console.log(`   └─ Verbs: [${verbs.join(', ')}]`);}
            if (__DEV__) {console.log(`   └─ Params: Intensity x${context.intensityMultiplier.toFixed(2)}, Speed x${context.speedMultiplier.toFixed(2)}, Texture: ${context.roughness.toFixed(2)}`);}
        }

        return context;
    }

    private static applyToContext(context: HapticContext, mapped: Partial<HapticContext>) {
        if (mapped.intensityMultiplier) {context.intensityMultiplier *= mapped.intensityMultiplier;}
        if (mapped.speedMultiplier) {context.speedMultiplier *= mapped.speedMultiplier;}
        if (mapped.roughness !== undefined) {context.roughness = Math.max(context.roughness, mapped.roughness);}
        if (mapped.sharpness !== undefined) {context.sharpness = mapped.sharpness;}
    }
}


