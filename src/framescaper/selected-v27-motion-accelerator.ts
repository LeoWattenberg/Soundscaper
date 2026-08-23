/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DisposableVideoMotionWebGl2AcceleratorV1,
	VideoMotionWebGl2FallbackReasonV1,
} from '../common/editor/video-motion-webgl2-v27.ts';

export interface FramescaperSelectedMotionAcceleratorAdmissionV27 {
	readonly accelerator: DisposableVideoMotionWebGl2AcceleratorV1 | null;
	readonly fallbackReason: VideoMotionWebGl2FallbackReasonV1 | null;
}

/** Lazy, non-visible admission boundary shared by selected preview and export. */
export async function createFramescaperSelectedMotionAcceleratorV27(
	createCanvas?: () => unknown,
): Promise<FramescaperSelectedMotionAcceleratorAdmissionV27> {
	const module = await import('../common/editor/video-motion-webgl2-v27.ts');
	let canvas: unknown;
	try {
		canvas = createCanvas?.() ?? globalThis.document?.createElement?.('canvas') ?? null;
	} catch {
		return Object.freeze({
			accelerator: null,
			fallbackReason: module.VIDEO_MOTION_WEBGL2_FALLBACK_REASONS_V1.canvasUnavailable,
		});
	}
	return module.createVideoMotionWebGl2AcceleratorAdmissionV1(canvas);
}
