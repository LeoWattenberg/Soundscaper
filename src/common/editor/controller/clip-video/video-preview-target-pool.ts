/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_PREVIEW_TARGET_NAMES = Object.freeze([
	'ping', 'pong', 'layer', 'composition', 'compositionSwap', 'anchor',
	'blurPing', 'blurPong',
] as const);

export type VideoPreviewTargetName = typeof VIDEO_PREVIEW_TARGET_NAMES[number];

/** Lazily owns injected GPU resources; plain previews need only the composition target. */
export function createVideoPreviewTargetPool<Target>(options: Readonly<{
	width: number;
	height: number;
	blurScale: number;
	allocate: (width: number, height: number) => Target;
	release: (target: Target) => void;
}>): Readonly<{
	get: (name: VideoPreviewTargetName) => Target;
	allocated: () => readonly Target[];
	dispose: () => void;
}> {
	const targets = new Map<VideoPreviewTargetName, Target>();
	let disposed = false;
	return Object.freeze({
		get(name: VideoPreviewTargetName): Target {
			if (disposed) throw new Error('The video preview target pool is disposed.');
			if (targets.has(name)) return targets.get(name) as Target;
			const scale = name === 'blurPing' || name === 'blurPong' ? options.blurScale : 1;
			const target = options.allocate(
				Math.max(1, Math.round(options.width * scale)),
				Math.max(1, Math.round(options.height * scale)),
			);
			targets.set(name, target);
			return target;
		},
		allocated: () => [...targets.values()],
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const target of targets.values()) options.release(target);
			targets.clear();
		},
	});
}
