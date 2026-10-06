/* SPDX-License-Identifier: AGPL-3.0-only */

interface ReelRequest {
	readonly reel: unknown;
	readonly reelIdentity?: string;
}

export interface EdlReelName {
	readonly name: string;
	readonly normalized: string;
	readonly truncated: boolean;
	readonly collisionResolved: boolean;
}

/** Keep one stable short reel per source without aliasing another source. */
export function allocateEdlReelNames(
	requests: readonly ReelRequest[],
	maximumLength: number,
): readonly EdlReelName[] {
	const normalized = requests.map((request, index) => {
		const raw = String(request.reel ?? '').trim();
		const name = raw.toUpperCase().replaceAll(/[^A-Z0-9_]+/gu, '_') || `REEL${String(index + 1)}`;
		return { name, preferred: name.slice(0, maximumLength), identity: request.reelIdentity ?? (raw || `empty:${String(index)}`) };
	});
	const reserved = new Set(normalized.map((entry) => entry.preferred));
	const used = new Set<string>();
	const identities = new Map<string, string>();
	return Object.freeze(normalized.map((entry) => {
		let name = identities.get(entry.identity);
		if (name === undefined) {
			name = entry.preferred;
			let suffix = 1;
			while (used.has(name)) {
				const ending = `_${String(++suffix)}`;
				name = `${entry.preferred.slice(0, maximumLength - ending.length)}${ending}`;
				if (reserved.has(name)) name = entry.preferred;
			}
			identities.set(entry.identity, name);
			used.add(name);
		}
		return Object.freeze({ name, normalized: entry.name,
			truncated: entry.name.length > maximumLength,
			collisionResolved: name !== entry.preferred });
	}));
}
