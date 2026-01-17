import { HapticKeyword } from '../types/hapticTypes';

export const HAPTIC_KEYWORDS: HapticKeyword[] = [
    // Oscillating (Smooth, wave-like)
    {
        keyword: 'breathing',
        category: 'oscillating',
        priority: 3,
        variations: ['breath', 'inhale', 'exhale', 'gasp', 'pant', 'sigh', 'groan', 'grunt'],
        baseProfile: {
            primitive: 'oscillator',
            baseFreq: 0.5, // Slow breath
            baseIntensity: 80,
            envelope: { attack: 0.3, decay: 0.1, sustain: 0.6, release: 0.5 }
        }
    },
    {
        keyword: 'heartbeat',
        category: 'oscillating',
        priority: 4,
        variations: ['pulse', 'thump', 'beating', 'pounding'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 1.2,
            baseIntensity: 150,
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.0, release: 0.1 },
            layers: [
                {
                    primitive: 'pulse',
                    baseFreq: 1.2,
                    baseIntensity: 150,
                    envelope: { attack: 0.05, decay: 0.1, sustain: 0.0, release: 0.1 },
                    durationMultiplier: 0.4
                },
                {
                    primitive: 'pulse',
                    baseFreq: 1.2,
                    baseIntensity: 100,
                    envelope: { attack: 0.05, decay: 0.1, sustain: 0.0, release: 0.1 },
                    startTimeOffset: 250, // The "dub"
                    durationMultiplier: 0.4
                }
            ]
        }
    },
    {
        keyword: 'engine',
        category: 'oscillating',
        priority: 5,
        variations: ['motor', 'hum', 'rumble', 'idle', 'purr', 'rev'],
        baseProfile: {
            primitive: 'oscillator',
            baseFreq: 15, // Low rumble
            baseIntensity: 100,
            envelope: { attack: 0.1, decay: 0.0, sustain: 1.0, release: 0.1 }
        }
    },
    {
        keyword: 'wind',
        category: 'oscillating',
        priority: 2,
        variations: ['breeze', 'gust', 'howl', 'whoosh'],
        baseProfile: {
            primitive: 'oscillator',
            baseFreq: 2.0, // Swirling wind
            baseIntensity: 60,
            envelope: { attack: 0.5, decay: 0.0, sustain: 0.8, release: 0.5 }
        }
    },

    // Textured (Rough, irregular)
    {
        keyword: 'explosion',
        category: 'textured',
        priority: 10,
        variations: ['blast', 'boom', 'detonate', 'erupt', 'bang'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 0,
            baseIntensity: 255,
            envelope: { attack: 0.05, decay: 0.6, sustain: 0.2, release: 0.4 },
            layers: [
                {
                    // Layer 1: The Initial Sharp Blast
                    primitive: 'transient',
                    baseFreq: 0,
                    baseIntensity: 255,
                    envelope: { attack: 0.0, decay: 0.2, sustain: 0.0, release: 0.0 },
                    durationMultiplier: 0.2
                },
                {
                    // Layer 2: The Deep Rolling Rumble
                    primitive: 'noise',
                    baseFreq: 5,
                    baseIntensity: 200,
                    grainSize: 40,
                    envelope: { attack: 0.1, decay: 0.8, sustain: 0.3, release: 0.5 }
                },
                {
                    // Layer 3: Sub-bass Shockwave
                    primitive: 'oscillator',
                    baseFreq: 2.0,
                    baseIntensity: 150,
                    envelope: { attack: 0.2, decay: 0.5, sustain: 1.0, release: 0.8 },
                    startTimeOffset: 100
                }
            ]
        }
    },
    {
        keyword: 'growl',
        category: 'textured',
        priority: 7,
        variations: ['snarl', 'roar', 'scream', 'screech', 'hiss', 'shriek'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 8, // Low growl
            baseIntensity: 120,
            grainSize: 30,
            envelope: { attack: 0.2, decay: 0.1, sustain: 0.7, release: 0.3 }
        }
    },
    {
        keyword: 'thunder',
        category: 'textured',
        priority: 8,
        variations: ['storm', 'lightning', 'rumbling'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 5,
            baseIntensity: 180,
            envelope: { attack: 0.1, decay: 0.4, sustain: 0.3, release: 0.6 },
            layers: [
                {
                    // Layer 1: Sharp Lightning Crackle
                    primitive: 'noise',
                    baseFreq: 15,
                    baseIntensity: 150,
                    grainSize: 10,
                    envelope: { attack: 0.0, decay: 0.2, sustain: 0.0, release: 0.1 },
                    durationMultiplier: 0.3
                },
                {
                    // Layer 2: Rolling Distant Rumble
                    primitive: 'noise',
                    baseFreq: 4,
                    baseIntensity: 180,
                    grainSize: 60,
                    envelope: { attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.8 }
                }
            ]
        }
    },
    {
        keyword: 'crash',
        category: 'textured',
        priority: 9,
        variations: ['smash', 'collision', 'shatter', 'break'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 0,
            baseIntensity: 200,
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.0, release: 0.2 },
            layers: [
                {
                    // Layer 1: The Hard Impact
                    primitive: 'transient',
                    baseFreq: 0,
                    baseIntensity: 220,
                    envelope: { attack: 0.0, decay: 0.1, sustain: 0.0, release: 0.0 },
                    durationMultiplier: 0.1
                },
                {
                    // Layer 2: The Shattering Glass
                    primitive: 'noise',
                    baseFreq: 0,
                    baseIntensity: 160,
                    grainSize: 5,
                    envelope: { attack: 0.1, decay: 0.4, sustain: 0.2, release: 0.4 },
                    startTimeOffset: 50
                }
            ]
        }
    },
    {
        keyword: 'gravel',
        category: 'textured',
        priority: 4,
        variations: ['crunch', 'scrape', 'grind', 'drag'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 0,
            baseIntensity: 90,
            grainSize: 20, // Fine grain
            envelope: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.1 }
        }
    },
    {
        keyword: 'firing',
        category: 'textured',
        priority: 8,
        variations: ['shooting', 'gunfire', 'fire'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 200,
            envelope: { attack: 0, decay: 0.1, sustain: 0, release: 0 }
        }
    },

    // Impact (Sharp, single event)
    {
        keyword: 'gunshot',
        category: 'impact',
        priority: 9,
        variations: ['shot', 'bullet', 'pop'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 220,
            envelope: { attack: 0, decay: 0.1, sustain: 0, release: 0 }
        }
    },
    {
        keyword: 'punch',
        category: 'impact',
        priority: 8,
        variations: ['hit', 'strike', 'slap', 'kick', 'whack', 'thud'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 160,
            envelope: { attack: 0.0, decay: 0.1, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'door',
        category: 'impact',
        priority: 5,
        variations: ['slam', 'close', 'open'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 10, // Quick thud
            baseIntensity: 120,
            envelope: { attack: 0.05, decay: 0.3, sustain: 0.0, release: 0.0 },
            layers: [
                {
                    // Layer 1: Lead "Thud"
                    primitive: 'pulse',
                    baseFreq: 8,
                    baseIntensity: 140,
                    envelope: { attack: 0.05, decay: 0.2, sustain: 0.0, release: 0.0 },
                    durationMultiplier: 0.4
                },
                {
                    // Layer 2: Echo/Vibration
                    primitive: 'noise',
                    baseFreq: 0,
                    baseIntensity: 80,
                    grainSize: 30,
                    envelope: { attack: 0.1, decay: 0.4, sustain: 0.0, release: 0.2 },
                    startTimeOffset: 150
                }
            ]
        }
    },
    {
        keyword: 'snap',
        category: 'impact',
        priority: 6,
        variations: ['crack', 'pop', 'break'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 100,
            envelope: { attack: 0.0, decay: 0.05, sustain: 0.0, release: 0.0 }
        }
    },

    // Rhythmic (Repeating patterns)
    {
        keyword: 'footstep',
        category: 'rhythmic',
        priority: 3,
        variations: ['step', 'walk', 'run', 'stomp', 'trot', 'footsteps'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 2.0, // Walking pace
            baseIntensity: 60,
            envelope: { attack: 0.05, decay: 0.1, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'marching',
        category: 'rhythmic',
        priority: 6,
        variations: ['march', 'parade'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 1.5,
            baseIntensity: 100,
            envelope: { attack: 0.05, decay: 0.1, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'knocking',
        category: 'rhythmic',
        priority: 5,
        variations: ['knock', 'rap', 'tap'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 5.0, // Sharp tap
            baseIntensity: 80,
            envelope: { attack: 0.0, decay: 0.05, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'beeping',
        category: 'rhythmic',
        priority: 6,
        variations: ['beep', 'signal', 'electronic'],
        baseProfile: {
            primitive: 'oscillator',
            baseFreq: 100, // High pitch beep simulation
            baseIntensity: 120,
            envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.05 }
        }
    },
    {
        keyword: 'typing',
        category: 'rhythmic',
        priority: 3,
        variations: ['type', 'keyboard'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 60,
            envelope: { attack: 0.0, decay: 0.05, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'clicking',
        category: 'rhythmic',
        priority: 3,
        variations: ['click', 'clicks'],
        baseProfile: {
            primitive: 'transient',
            baseFreq: 0,
            baseIntensity: 50,
            envelope: { attack: 0.0, decay: 0.03, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'ticking',
        category: 'rhythmic',
        priority: 2,
        variations: ['tick', 'tock', 'clock'],
        baseProfile: {
            primitive: 'pulse',
            baseFreq: 1.0,
            baseIntensity: 40,
            envelope: { attack: 0.0, decay: 0.02, sustain: 0.0, release: 0.0 }
        }
    },
    {
        keyword: 'applause',
        category: 'rhythmic',
        priority: 5,
        variations: ['clap', 'cheer', 'clapping'],
        baseProfile: {
            primitive: 'noise',
            baseFreq: 0,
            baseIntensity: 90,
            grainSize: 15,
            envelope: { attack: 0.1, decay: 0.2, sustain: 0.6, release: 0.3 }
        }
    }
];
