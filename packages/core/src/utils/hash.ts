/** Fast string hash (djb2) — good enough for dedup within a single profile run. */
export function hashStr(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h;
}
