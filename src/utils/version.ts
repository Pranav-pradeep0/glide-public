/**
 * `v`-prefixed or bare `MAJOR.MINOR[.PATCH]`, optionally followed by a `-prerelease` or
 * `+build` suffix, which is ignored (CI tags releases `vX.Y.Z-build.N`). Anything else is
 * invalid: `1.x.3` must not quietly become 1.3.0 by dropping the part that failed to parse.
 */
const VERSION_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.+-]*)?$/i;

export function parseVersion(raw: string): [number, number, number] | null {
    const match = VERSION_RE.exec((raw ?? '').trim());
    if (!match) {return null;}
    return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Canonical `X.Y.Z`, or '' when [raw] is not a version. */
export function normalizeVersion(raw: string): string {
    const parts = parseVersion(raw);
    return parts ? parts.join('.') : '';
}

/**
 * Sign of a - b by numeric precedence. **NaN when either is not a version**, which every
 * caller treats as "not newer" and "not the same" -- so a malformed tag can neither offer an
 * update nor keep a cached APK alive.
 */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) {return NaN;}
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) {return pa[i] > pb[i] ? 1 : -1;}
    }
    return 0;
}
