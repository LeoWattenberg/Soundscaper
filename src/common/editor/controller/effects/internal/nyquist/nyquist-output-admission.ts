/* SPDX-License-Identifier: AGPL-3.0-only */

import { NYQUIST_MAX_TOTAL_AUDIO_SAMPLES } from '../../../../nyquist/protocol.js';

export interface NyquistOutputAdmission {
	readonly renderFrames: number;
	readonly completeFrames: number | null;
}

/** One unpublished sentinel frame distinguishes a complete result from a capped render. */
export function planNyquistOutputAdmission(
	maximumFrames: number, inputChannelCount: number, preview: boolean,
): NyquistOutputAdmission {
	if (preview) return { renderFrames: maximumFrames, completeFrames: null };
	const memoryFrames = Math.floor(NYQUIST_MAX_TOTAL_AUDIO_SAMPLES / Math.max(1, inputChannelCount));
	const completeFrames = Math.min(maximumFrames, memoryFrames - 1);
	return { renderFrames: completeFrames + 1, completeFrames };
}

interface Result {
	readonly type?: string;
	readonly frameCount?: number;
	readonly channels?: readonly Float32Array[];
}

export function assertCompleteNyquistOutput(
	result: Result | null | undefined,
	admission: NyquistOutputAdmission,
	createError: () => Error,
): void {
	if (admission.completeFrames === null || result?.type !== 'audio') return;
	const frames = result.frameCount ?? result.channels?.[0]?.length ?? 0;
	if (frames > admission.completeFrames) throw createError();
}
