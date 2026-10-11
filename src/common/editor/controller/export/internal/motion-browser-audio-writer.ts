/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAudioMixBlock } from '../../../motion-audio-contract.ts';
import { validateMotionAudioWindow } from '../../../motion-audio-contract.ts';
import { motionVideoAudioBoundary, type MotionVideoAudioDelivery } from '../../../motion-video-delivery.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals } from '../../../timeline-time.ts';
import { throwIfScapeAborted } from '../../../scape-abort.ts';
import type { MotionRenderPlan } from '../motion-render-pipeline.ts';

/** Authenticate each PCM block and permit at most the upcoming video frame's audio ahead. */
export function createMotionBrowserAudioWriter(plan: MotionRenderPlan, audio: MotionVideoAudioDelivery,
	add: ((block: MotionAudioMixBlock, timestamp: number) => Promise<void>) | undefined, assertOpen: () => void, videoFrames: () => number) {
	if (!add) throw new Error('The admitted motion muxer cannot consume audio.');
	const start = multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), audio.sampleRate);
	let written = 0; let busy = false;
	return {
		get busy() { return busy; }, get complete() { return !busy && written === audio.sampleCount; },
		assertFrameReady(frame: number): void {
			if (busy || written < motionVideoAudioBoundary(frame, plan, audio.sampleRate)) throw new Error('Motion video requires its ordered audio samples before this frame.');
		},
		sink: { sampleRate: audio.sampleRate, channels: audio.channels,
			async write(block: MotionAudioMixBlock, signal?: AbortSignal): Promise<void> {
				assertOpen(); throwIfScapeAborted(signal);
				if (block.projectId !== plan.identity.projectId || block.revisionDigest !== plan.identity.revisionDigest || block.compositionId !== plan.identity.compositionId) throw new Error('Motion video PCM revision identity changed.');
				if (busy || block.sampleRate !== audio.sampleRate || block.channels !== audio.channels || !Number.isSafeInteger(block.sampleCount) || block.sampleCount < 1 || block.sampleCount > 4096
					|| compareRationals(block.startSample, addRationals(start, written)) !== 0 || written + block.sampleCount > audio.sampleCount
					|| written + block.sampleCount > motionVideoAudioBoundary(videoFrames() + 1, plan, audio.sampleRate)) throw new Error('Motion video PCM timing, format or block order changed.');
				validateMotionAudioWindow(block.interleaved, block.sampleCount, { ...audio, sampleCount: block.sampleCount });
				busy = true;
				try { await add(block, written / audio.sampleRate); assertOpen(); throwIfScapeAborted(signal); written += block.sampleCount; }
				finally { busy = false; }
			},
		},
	};
}
