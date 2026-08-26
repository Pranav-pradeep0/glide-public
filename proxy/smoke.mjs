//   BASE_URL=https://glide-ai-proxy.<account>.workers.dev node smoke.mjs
//   SMOKE_AUDIO=1 BASE_URL=... node smoke.mjs   # also runs a real transcription (uses Groq quota)

const base = process.env.BASE_URL?.replace(/\/$/, '');
if (!base) {
    console.error('Set BASE_URL to the deployed Worker URL.');
    process.exit(1);
}
const runAudio = process.env.SMOKE_AUDIO === '1';

let failures = 0;

async function check(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (e) {
        failures++;
        console.error(`FAIL ${name}: ${e.message}`);
    }
}

function expectStatus(res, status) {
    if (res.status !== status) {
        throw new Error(`expected ${status}, got ${res.status}`);
    }
}

async function readJson(res) {
    const body = await res.json();
    if (typeof body !== 'object' || body === null) {
        throw new Error('response was not a JSON object');
    }
    return body;
}

function silenceWav(seconds = 1) {
    const sampleRate = 16000;
    const samples = sampleRate * seconds;
    const dataBytes = samples * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buf);
    const ascii = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    return new Blob([buf], { type: 'audio/wav' });
}

const dialogue =
    "I never thought it would end like this. You promised me the city would be safe. " +
    "Promises are made to be broken, and bridges are made to burn. Look around you — " +
    "everything we built is falling apart. Then we build it again, together, one stone at a time. " +
    "There is no time left to rebuild; the fleet arrives at dawn. Then dawn will find us ready.";

await check('GET /v1/recap -> 405', async () => {
    expectStatus(await fetch(`${base}/v1/recap`, { method: 'GET' }), 405);
});

await check('POST /v1/nope -> 404', async () => {
    expectStatus(await fetch(`${base}/v1/nope`, { method: 'POST' }), 404);
});

await check('recap happy path -> 200 with recap text', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue, title: 'Smoke Test' }),
    });
    expectStatus(res, 200);
    const body = await readJson(res);
    if (typeof body.recap !== 'string' || body.recap.length === 0) {
        throw new Error('missing recap text');
    }
});

await check('oversized dialogue -> 400', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue: 'a'.repeat(6000) }),
    });
    expectStatus(res, 400);
});

await check('oversized transport body -> 413', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dialogue: 'a'.repeat(90000) }),
    });
    expectStatus(res, 413);
});

await check('invalid JSON -> 400', async () => {
    const res = await fetch(`${base}/v1/recap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
    });
    expectStatus(res, 400);
});

await check('transcribe without file -> 400', async () => {
    const form = new FormData();
    form.append('task', 'transcribe');
    const res = await fetch(`${base}/v1/transcribe`, { method: 'POST', body: form });
    expectStatus(res, 400);
});

if (runAudio) {
    await check('transcribe silent wav -> 200 with text field', async () => {
        const form = new FormData();
        form.append('file', silenceWav(), 'audio.wav');
        form.append('task', 'transcribe');
        const res = await fetch(`${base}/v1/transcribe`, { method: 'POST', body: form });
        expectStatus(res, 200);
        const body = await readJson(res);
        if (typeof body.text !== 'string') {
            throw new Error('missing text field');
        }
    });
}

// Rate limit is 6/60s per IP per location, so run this last.
await check('flood -> at least one 429 within limit window', async () => {
    let saw429 = false;
    for (let i = 0; i < 10; i++) {
        const res = await fetch(`${base}/v1/recap`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
        });
        if (res.status === 429) {
            saw429 = true;
            break;
        }
        if (res.status !== 200 && res.status !== 400) {
            throw new Error(`unexpected ${res.status} during flood`);
        }
    }
    if (!saw429) {
        throw new Error('no 429 after 10 rapid requests');
    }
});

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
