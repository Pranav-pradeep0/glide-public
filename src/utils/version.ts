export function normalizeVersion(raw: string): string {
    if (!raw) {return '';}
    const trimmed = raw.trim();
    const withoutPrefix = trimmed.startsWith('v') || trimmed.startsWith('V')
        ? trimmed.slice(1)
        : trimmed;
    const withoutBuild = withoutPrefix.split('+')[0];
    const withoutPre = withoutBuild.split('-')[0];
    return withoutPre.trim();
}

export function compareVersions(a: string, b: string): number {
    const aNorm = normalizeVersion(a);
    const bNorm = normalizeVersion(b);

    const aParts = aNorm.split('.').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
    const bParts = bNorm.split('.').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));

    const maxLen = Math.max(aParts.length, bParts.length, 3);
    while (aParts.length < maxLen) {aParts.push(0);}
    while (bParts.length < maxLen) {bParts.push(0);}

    for (let i = 0; i < maxLen; i++) {
        if (aParts[i] > bParts[i]) {return 1;}
        if (aParts[i] < bParts[i]) {return -1;}
    }
    return 0;
}

