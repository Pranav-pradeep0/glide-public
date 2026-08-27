// React Native installs these as globals in Libraries/Core/setUpTimers.js but ships no
// types for them. InteractionManager, the old way to defer work past an animation, was
// removed in 0.87 and these are its replacement.
declare function requestIdleCallback(
    callback: (deadline: {timeRemaining: () => number; didTimeout: boolean}) => void,
    options?: {timeout: number},
): number;

declare function cancelIdleCallback(handle: number): void;
