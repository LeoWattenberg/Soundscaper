/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAudioFormat, validateMotionAudioWindow } from '../../../motion-audio-contract.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals } from '../../../timeline-time.ts';
import { throwIfScapeAborted } from '../../../scape-abort.ts';
import type { MotionRenderLease, MotionRenderPlan, MotionRenderSink } from '../motion-render-pipeline.ts';

/** One bounded PCM block at a time. Cumulative ceilings cannot accumulate frame rounding drift. */
export function createMotionRenderAudio(plan: MotionRenderPlan, lease: MotionRenderLease, sink: MotionRenderSink<unknown>) {
	if (!sink.audio) return null;
	if (sink.audioPolicy === 'exclude') throw new Error('Motion delivery cannot both consume and exclude audio.');
	const mixer = lease.audioMixer; if (!mixer) throw new Error('Motion audio delivery requires a retained audio mixer.');
	if (mixer.revision.projectId !== plan.identity.projectId || mixer.revision.digest !== plan.identity.revisionDigest) throw new Error('Motion audio mixer belongs to a different pinned revision.');
	const output = sink.audio;
	const format = normalizeMotionAudioFormat({ sampleRate: output.sampleRate, channels: output.channels, sampleCount: 0 });
	const startSample = multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), format.sampleRate);
	let written = 0;
	const boundary = (frame: number): number => {
		const numerator = BigInt(frame) * BigInt(format.sampleRate) * BigInt(plan.frameRate.den); const denominator = BigInt(plan.frameRate.num);
		const samples = (numerator + denominator - 1n) / denominator;
		if (samples > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Motion delivery exceeds exact audio sample coordinates.');
		return Number(samples);
	};
	boundary(plan.frameCount);
	return { async writeThroughFrame(frame: number, signal?: AbortSignal): Promise<void> {
		const end = boundary(frame);
		while (written < end) {
			throwIfScapeAborted(signal);
			const sampleCount = Math.min(4096, end - written); const position = addRationals(startSample, written);
			const block = await mixer.mixBlock({ compositionId: plan.identity.compositionId, startSample: position, sampleCount,
				sampleRate: format.sampleRate, channels: format.channels }, signal);
			throwIfScapeAborted(signal);
			if (block.projectId !== plan.identity.projectId || block.revisionDigest !== plan.identity.revisionDigest || block.revision !== mixer.revision.revision
				|| block.compositionId !== plan.identity.compositionId || compareRationals(block.startSample, position) !== 0
				|| block.sampleCount !== sampleCount || block.sampleRate !== format.sampleRate || block.channels !== format.channels) throw new Error('Motion renderer received a stale or malformed audio mix block.');
			validateMotionAudioWindow(block.interleaved, sampleCount, format);
			await output.write(block, signal); throwIfScapeAborted(signal); written += sampleCount;
		}
	} };
}
