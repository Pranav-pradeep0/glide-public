const DEFAULT_ABORT_MESSAGE = 'The operation was aborted.';
const abortReasons = new WeakMap<AbortSignal, Error>();

export class NetworkTimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number) {
        super(`Request timed out after ${timeoutMs}ms`);
        this.name = 'NetworkTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

function createAbortError(message: string = DEFAULT_ABORT_MESSAGE): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function setAbortReason(signal: AbortSignal, error: Error): void {
    abortReasons.set(signal, error);
}

function getAbortReason(signal: AbortSignal): Error {
    return abortReasons.get(signal) ?? createAbortError();
}

function abortSignalWithTimeout(
    timeoutMs: number,
    signal?: AbortSignal
): {
    signal: AbortSignal;
    cleanup: () => void;
} {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;

    const clear = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
            onAbort = null;
        }
    };

    if (signal?.aborted) {
        setAbortReason(controller.signal, createAbortError());
        controller.abort();
        return { signal: controller.signal, cleanup: clear };
    }

    onAbort = () => {
        setAbortReason(controller.signal, createAbortError());
        controller.abort();
    };
    if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
        setAbortReason(controller.signal, new NetworkTimeoutError(timeoutMs));
        controller.abort();
    }, timeoutMs);

    return { signal: controller.signal, cleanup: clear };
}

export async function fetchJsonWithTimeout<T>(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = 10000
): Promise<T> {
    const response = await fetchWithTimeout(url, init, timeoutMs);
    return await response.json() as T;
}

export async function fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = 10000
): Promise<Response> {
    const { signal, cleanup } = abortSignalWithTimeout(timeoutMs, init.signal);

    try {
        return await fetch(url, { ...init, signal });
    } catch (error) {
        if (signal.aborted) {
            throw getAbortReason(signal);
        }
        throw error;
    } finally {
        cleanup();
    }
}

export type InFlightRequest<T> = {
    controller: AbortController;
    consumers: number;
    promise: Promise<T>;
};

export function createCoalescedRequest<T>(
    inFlightRequests: Map<string, InFlightRequest<T>>,
    key: string,
    execute: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
): Promise<T> {
    let request = inFlightRequests.get(key);

    if (!request) {
        const controller = new AbortController();
        const promise = execute(controller.signal).finally(() => {
            inFlightRequests.delete(key);
        });

        request = {
            controller,
            consumers: 0,
            promise,
        };
        inFlightRequests.set(key, request);
    }

    const sharedRequest = request;
    sharedRequest.consumers += 1;

    return new Promise<T>((resolve, reject) => {
        let finished = false;

        const release = () => {
            if (finished) {return;}
            finished = true;
            sharedRequest.consumers = Math.max(0, sharedRequest.consumers - 1);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            if (sharedRequest.consumers === 0 && !sharedRequest.controller.signal.aborted) {
                setAbortReason(sharedRequest.controller.signal, createAbortError());
                sharedRequest.controller.abort();
            }
        };

        const onAbort = () => {
            release();
            reject(createAbortError());
        };

        if (signal?.aborted) {
            onAbort();
            return;
        }

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        sharedRequest.promise.then(
            (value) => {
                release();
                resolve(value);
            },
            (error) => {
                release();
                reject(error);
            }
        );
    });
}
