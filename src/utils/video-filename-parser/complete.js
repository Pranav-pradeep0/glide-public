const completeDvdExp = /\b(NTSC|PAL)?.DVDR\b/i;
export function isCompleteDvd(title) {
    return completeDvdExp.test(title) || undefined;
}
const completeExp = /\b(COMPLETE)\b/i;
export function isComplete(title) {
    return completeExp.test(title) || isCompleteDvd(title) || undefined;
}
