interface RateLimitResult {
    success: boolean;
}

interface RateLimit {
    limit(key: { key: string }): Promise<RateLimitResult>;
}

export interface Env {
    GROQ_API_KEY: string;
    AI_RATE_LIMITER: RateLimit;
    AI_GLOBAL_LIMITER: RateLimit;
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TRANSLATIONS_URL = 'https://api.groq.com/openai/v1/audio/translations';

const CHAT_MODEL = 'openai/gpt-oss-120b';
const AUDIO_MODEL = 'whisper-large-v3';

const MAX_DIALOGUE_CHARS = 5000;
const MAX_TITLE_CHARS = 200;
const MAX_RECAP_BODY_BYTES = 8 * 1024;
const MAX_AUDIO_BYTES = 1024 * 1024; // 10s/16kHz/mono/16-bit is ~320KB
const CHAT_TIMEOUT_MS = 15000;
const AUDIO_TIMEOUT_MS = 30000;

const LANGUAGE_RE = /^[a-z]{2}$/;

const RECAP_SYSTEM_PROMPT = `You are a cinematic recap expert. Your task is to provide a "Previously on..." style recap based on provided dialogue.

GUIDELINES:
- Context: Use the movie/show title (if provided) to ground your recap and name characters if they appear in the text.
- Tone: Dramatic, cinematic, and engaging.
- Length: Concise, exactly 2-3 sentences.
- Focus: Highlight major plot beats, emotional shifts, or impending conflicts.
- Sparse Scenes: If the dialogue is generic, summarize the vibe or situation (e.g., "Tensions rise as the group faces an uncertain future").
- No Meta: Do not mention being an AI or say "Based on the dialogue."`;

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
}

function err(status: number, message: string, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
    });
}

// Never log request content, response bodies, or credentials.
function logRoute(route: string, status: number): void {
    console.log(JSON.stringify({ route, status }));
}

function logUpstreamFailure(route: string, upstreamStatus: number): void {
    console.log(JSON.stringify({ route, status: 502, upstream_status: upstreamStatus }));
}

// ponytail: per-colo burst gates, not a spend budget. The binding only supports 10s/60s
// windows, so the actual cost bound is the spending limit set in the Groq console. Move to
// a Durable Object / KV counter only if a real daily cap is needed.
async function checkRate(env: Env, request: Request, route: string): Promise<Response | null> {
    const key = `${route}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`;
    const [perIp, global] = await Promise.all([
        env.AI_RATE_LIMITER.limit({ key }),
        env.AI_GLOBAL_LIMITER.limit({ key: 'all' }),
    ]);
    if (perIp.success && global.success) {
        return null;
    }
    return err(429, 'Too many requests. Try again shortly.', { 'retry-after': '60' });
}

async function readCappedText(request: Request, capBytes: number): Promise<{ text: string; tooLarge: boolean }> {
    const reader = request.body?.getReader();
    if (!reader) {
        return { text: '', tooLarge: false };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        received += value.byteLength;
        if (received > capBytes) {
            await reader.cancel();
            return { text: '', tooLarge: true };
        }
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return { text: out, tooLarge: false };
}

async function handleRecap(request: Request, env: Env): Promise<Response> {
    const body = await readCappedText(request, MAX_RECAP_BODY_BYTES);
    if (body.tooLarge) {
        logRoute('recap', 413);
        return err(413, 'Recap request too large.');
    }

    let parsed: { dialogue?: unknown; title?: unknown };
    try {
        parsed = JSON.parse(body.text) as { dialogue?: unknown; title?: unknown };
    } catch {
        logRoute('recap', 400);
        return err(400, 'Invalid JSON.');
    }

    const dialogue = typeof parsed.dialogue === 'string' ? parsed.dialogue : '';
    const title = typeof parsed.title === 'string' ? parsed.title.slice(0, MAX_TITLE_CHARS) : '';

    if (!dialogue || dialogue.length > MAX_DIALOGUE_CHARS) {
        logRoute('recap', 400);
        return err(400, `dialogue must be a string of 1-${MAX_DIALOGUE_CHARS} characters.`);
    }

    const contextInput = title ? `Movie/Show Title: "${title}"\n\n` : '';
    const upstream = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        headers: {
            authorization: `Bearer ${env.GROQ_API_KEY}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: CHAT_MODEL,
            messages: [
                { role: 'system', content: RECAP_SYSTEM_PROMPT },
                { role: 'user', content: `${contextInput}Dialogue from the last few minutes:\n"${dialogue}"` },
            ],
            temperature: 0.7,
            max_completion_tokens: 300,
            reasoning_effort: 'low',
        }),
    });

    if (!upstream.ok) {
        logUpstreamFailure('recap', upstream.status);
        return err(502, 'Recap service unavailable.');
    }

    const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
    const recap = data.choices?.[0]?.message?.content?.trim();
    if (!recap) {
        logUpstreamFailure('recap', upstream.status);
        return err(502, 'Recap service returned no summary.');
    }

    logRoute('recap', 200);
    return json({ recap });
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_AUDIO_BYTES) {
        logRoute('transcribe', 413);
        return err(413, 'Audio clip too large.');
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        logRoute('transcribe', 400);
        return err(400, 'Expected multipart form data.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
        logRoute('transcribe', 400);
        return err(400, 'Missing audio file.');
    }
    if (file.size > MAX_AUDIO_BYTES) {
        logRoute('transcribe', 413);
        return err(413, 'Audio clip too large.');
    }

    const task = form.get('task');
    if (task !== 'transcribe' && task !== 'translate') {
        logRoute('transcribe', 400);
        return err(400, "task must be 'transcribe' or 'translate'.");
    }

    let language: string | null = null;
    const rawLanguage = form.get('language');
    if (rawLanguage !== null) {
        if (typeof rawLanguage !== 'string' || !LANGUAGE_RE.test(rawLanguage)) {
            logRoute('transcribe', 400);
            return err(400, 'language must be an ISO-639-1 code.');
        }
        language = rawLanguage;
    }

    const out = new FormData();
    out.append('file', file, 'audio.wav');
    out.append('model', AUDIO_MODEL);
    out.append('response_format', 'json');
    if (task === 'transcribe' && language !== null) {
        out.append('language', language);
    }

    const url = task === 'translate' ? GROQ_TRANSLATIONS_URL : GROQ_TRANSCRIPTIONS_URL;
    const upstream = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: out,
    });

    if (!upstream.ok) {
        logUpstreamFailure('transcribe', upstream.status);
        return err(502, 'Transcription service unavailable.');
    }

    const data = await upstream.json() as { text?: string };
    logRoute('transcribe', 200);
    return json({ text: (data.text ?? '').trim() });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method !== 'POST') {
            return err(405, 'Method not allowed.', { allow: 'POST' });
        }

        const route = url.pathname === '/v1/recap'
            ? 'recap'
            : url.pathname === '/v1/transcribe'
                ? 'transcribe'
                : null;
        if (!route) {
            return err(404, 'Not found.');
        }

        if (!env.GROQ_API_KEY) {
            logRoute(route, 502);
            return err(502, 'Service not configured.');
        }

        const limited = await checkRate(env, request, route);
        if (limited) {
            logRoute(route, 429);
            return limited;
        }

        try {
            return await (route === 'recap' ? handleRecap(request, env) : handleTranscribe(request, env));
        } catch (error) {
            const timedOut = error instanceof Error && error.name === 'TimeoutError';
            logRoute(route, timedOut ? 504 : 502);
            return timedOut
                ? err(504, 'Request timed out.')
                : err(502, 'Upstream service error.');
        }
    },
};
