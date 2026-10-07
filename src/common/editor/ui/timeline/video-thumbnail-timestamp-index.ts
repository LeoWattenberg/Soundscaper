/* SPDX-License-Identifier: AGPL-3.0-only */

interface ThumbnailCandidate { readonly [key: string]: unknown; }

/** The row owns one immutable thumbnail catalog; duplicate timestamps keep authored order. */
export function createVideoThumbnailTimestampLookup(candidates: unknown): ((time: number) => ThumbnailCandidate | undefined) | null {
	if (!Array.isArray(candidates)) return null;
	const entries: { timestamp: number; ordinal: number; candidate: ThumbnailCandidate }[] = [];
	for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
		const candidate = candidates[ordinal] as ThumbnailCandidate | null | undefined;
		const timestamp = Number(candidate?.sourceTimeSeconds ?? candidate?.timestamp ?? candidate?.time);
		if (candidate && typeof candidate === 'object' && Number.isFinite(timestamp)) entries.push({ timestamp, ordinal, candidate });
	}
	entries.sort((left, right) => left.timestamp - right.timestamp || left.ordinal - right.ordinal);
	return time => {
		if (!Number.isFinite(time)) return undefined;
		let low = 0; let high = entries.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			const value = entries[middle]!.timestamp;
			if (value < time && Math.abs(value - time) >= 0.05) low = middle + 1;
			else high = middle;
		}
		let result: typeof entries[number] | undefined;
		for (let index = low; index < entries.length; index++) {
			const entry = entries[index]!;
			if (entry.timestamp > time && Math.abs(entry.timestamp - time) >= 0.05) break;
			if (Math.abs(entry.timestamp - time) < 0.05 && (!result || entry.ordinal < result.ordinal)) result = entry;
			if (result?.ordinal === 0) break;
		}
		return result?.candidate;
	};
}
