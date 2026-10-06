/* SPDX-License-Identifier: AGPL-3.0-only */

/** Extra retained PCM is charged to the macro's existing admission headroom. */
export const MACRO_NEIGHBOUR_PCM_CACHE_LIMIT_BYTES = 4 * 1024 ** 2;

/** One run owns this bounded cache. Entries never leave it without an owned copy. */
export function createMacroNeighbourPcmCache(requestedBytes: number) {
	const limit = Number.isFinite(requestedBytes)
		? Math.min(MACRO_NEIGHBOUR_PCM_CACHE_LIMIT_BYTES, Math.max(0, Math.floor(requestedBytes))) : 0;
	const entries = new Map<string, readonly Float32Array[]>();
	let retainedBytes = 0;
	return {
		get(key: string): Float32Array[] | null {
			return entries.get(key)?.map((channel) => channel.slice()) ?? null;
		},
		retain(key: string, channels: readonly Float32Array[]): void {
			const bytes = channels.reduce((sum, channel) => sum + channel.byteLength, 0);
			if (!bytes || bytes > limit || entries.has(key)) return;
			while (retainedBytes + bytes > limit) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				retainedBytes -= entries.get(oldest)!.reduce((sum, channel) => sum + channel.byteLength, 0);
				entries.delete(oldest);
			}
			entries.set(key, channels.map((channel) => channel.slice()));
			retainedBytes += bytes;
		},
	};
}

export type MacroNeighbourPcmCache = ReturnType<typeof createMacroNeighbourPcmCache>;
