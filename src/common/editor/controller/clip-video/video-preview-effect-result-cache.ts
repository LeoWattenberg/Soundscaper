/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoPreviewEffectResultInput {
	readonly texture: object;
	readonly frameVersion: number;
	readonly targets: object;
	readonly passes: readonly unknown[];
	readonly width: number;
	readonly height: number;
	readonly viewport: Readonly<{ x: number; y: number; width: number; height: number }>;
}

interface CachedResult<Target> {
	readonly texture: object;
	readonly frameVersion: number;
	readonly targets: object;
	readonly signature: string;
	readonly target: Target;
}

/** Keep one completed GPU effect result; resource ownership stays with the injected target pool. */
export function createVideoPreviewEffectResultCache<Target>(): Readonly<{
	get: (input: VideoPreviewEffectResultInput) => Target | null;
	store: (input: VideoPreviewEffectResultInput, target: Target) => void;
	clear: () => void;
}> {
	let cached: CachedResult<Target> | null = null;
	return Object.freeze({
		get(input: VideoPreviewEffectResultInput): Target | null {
			if (!cached || cached.texture !== input.texture || cached.frameVersion !== input.frameVersion
				|| cached.targets !== input.targets || cached.signature !== signature(input)) return null;
			return cached.target;
		},
		store(input: VideoPreviewEffectResultInput, target: Target): void {
			cached = {
				texture: input.texture, frameVersion: input.frameVersion,
				targets: input.targets, signature: signature(input), target,
			};
		},
		clear(): void { cached = null; },
	});
}

function signature(input: VideoPreviewEffectResultInput): string {
	// Snapshot resolved shader values, including animated effects. Geometry and
	// transition opacity are applied after these effects and keep their cadence.
	return JSON.stringify([input.passes, input.width, input.height, input.viewport]);
}
