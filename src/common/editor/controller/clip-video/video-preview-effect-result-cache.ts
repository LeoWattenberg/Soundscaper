/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bound optional retained GPU output independently of the shared scratch targets. */
export const VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_ENTRIES = 4;
export const VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_BYTES = 64 * 1024 * 1024;

type CacheKey = string | object;

export interface VideoPreviewEffectResultInput {
	readonly key: CacheKey;
	readonly texture: object;
	readonly frameVersion: number;
	readonly targets: object;
	readonly passes: readonly unknown[];
	readonly width: number;
	readonly height: number;
	readonly viewport: Readonly<{ x: number; y: number; width: number; height: number }>;
}

interface CachedResult {
	readonly texture: object;
	readonly frameVersion: number;
	readonly signature: string;
}

interface OwnedTarget<Target> {
	readonly target: Target;
	readonly targets: object;
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
	result: CachedResult | null;
	seen: boolean;
}

/** Own one optional completed GPU result per active clip through injected resources. */
export function createVideoPreviewEffectResultCache<Target extends object>(resources: Readonly<{
	allocate: (width: number, height: number) => Target;
	release: (target: Target) => void;
}>): Readonly<{
	beginFrame: (activeKeys: Iterable<CacheKey>) => void;
	endFrame: () => void;
	get: (input: VideoPreviewEffectResultInput) => Target | null;
	acquire: (input: VideoPreviewEffectResultInput) => Target | null;
	store: (input: VideoPreviewEffectResultInput, target: Target) => void;
	clear: () => void;
}> {
	const entries = new Map<CacheKey, OwnedTarget<Target>>();
	let retainedBytes = 0;
	function release(key: CacheKey, entry: OwnedTarget<Target>): void {
		entries.delete(key);
		retainedBytes -= entry.byteLength;
		resources.release(entry.target);
	}
	return Object.freeze({
		beginFrame(activeKeys: Iterable<CacheKey>): void {
			const active = new Set(activeKeys);
			for (const [key, entry] of entries) {
				if (!active.has(key)) release(key, entry);
				else entry.seen = false;
			}
		},
		endFrame(): void {
			for (const [key, entry] of entries) if (!entry.seen) release(key, entry);
		},
		get(input: VideoPreviewEffectResultInput): Target | null {
			const entry = entries.get(input.key);
			const cached = entry?.result;
			if (!entry || !cached || cached.texture !== input.texture
				|| cached.frameVersion !== input.frameVersion || entry.targets !== input.targets
				|| cached.signature !== signature(input)) return null;
			entry.seen = true;
			return entry.target;
		},
		acquire(input: VideoPreviewEffectResultInput): Target | null {
			let entry = entries.get(input.key);
			if (entry && (entry.width !== input.width || entry.height !== input.height
				|| entry.targets !== input.targets)) {
				release(input.key, entry);
				entry = undefined;
			}
			if (entry) {
				entry.result = null;
				entry.seen = true;
				return entry.target;
			}
			const byteLength = input.width * input.height * 4;
			if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height)
				|| input.width < 1 || input.height < 1 || !Number.isSafeInteger(byteLength)
				|| entries.size >= VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_ENTRIES
				|| retainedBytes + byteLength > VIDEO_PREVIEW_EFFECT_CACHE_MAXIMUM_BYTES) return null;
			let target: Target;
			try {
				target = resources.allocate(input.width, input.height);
			} catch {
				// The stack can still composite its existing shared scratch output.
				return null;
			}
			entries.set(input.key, {
				target, targets: input.targets, width: input.width, height: input.height,
				byteLength, result: null, seen: true,
			});
			retainedBytes += byteLength;
			return target;
		},
		store(input: VideoPreviewEffectResultInput, target: Target): void {
			const entry = entries.get(input.key);
			if (!entry || entry.target !== target || entry.targets !== input.targets
				|| entry.width !== input.width || entry.height !== input.height) return;
			entry.result = {
				texture: input.texture, frameVersion: input.frameVersion, signature: signature(input),
			};
		},
		clear(): void {
			for (const [key, entry] of entries) release(key, entry);
		},
	});
}

function signature(input: VideoPreviewEffectResultInput): string {
	// Snapshot resolved shader values, including animated effects. Geometry and
	// transition opacity are applied after these effects and keep their cadence.
	return JSON.stringify([input.passes, input.width, input.height, input.viewport]);
}
