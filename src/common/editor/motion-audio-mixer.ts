/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionSceneEvaluator, type MotionEvaluatedAudio } from './motion-composition-evaluation.ts';
import { createMotionscaperRevision } from './motion-project-revision.ts';
import { addRationals, divideRationals, multiplyRationals, subtractRationals } from './timeline-time.ts';
import { motionInteger } from './motion-values.ts';
import { MOTION_AUDIO_MAX_BLOCK_SAMPLES, normalizeMotionAudioBlockRequest, type MotionAudioAsset, type MotionAudioMixer, type MotionAudioMixerOptions } from './motion-audio-contract.ts';
import { createMotionAudioWindowCache } from './motion-audio-window-cache.ts';
import { createMotionExpressionAudioPreparation, motionProjectUsesAudioAmplitude } from './motion-expression-audio-preparation.ts';
import { createMotionAmplitudeNativeBudget } from './motion-expression-audio-energy.ts';
import { createMotionExpressionBudget } from './motion-expression-evaluator.ts';
import { createMotionAudioSampler } from './motion-audio-sampling.ts';

/** Sample-addressable, revision-pinned mixing. All timing comes from the same scene evaluator as video. */
export function createMotionAudioMixer(options: MotionAudioMixerOptions): MotionAudioMixer {
	const revision = createMotionscaperRevision(options.project); const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	const expressionAudio = options.expressionAudio ?? (motionProjectUsesAudioAmplitude(revision.project) ? createMotionExpressionAudioPreparation({ project: revision.project, provider: options.provider }) : undefined);
	if (expressionAudio && expressionAudio.revision.digest !== revision.digest) throw new RangeError('Audio mixer amplitude preparation belongs to a stale revision.');
	const maximumBlock = motionInteger(options.maximumBlockSamples ?? 4096, 'maximum audio block samples', 1, MOTION_AUDIO_MAX_BLOCK_SAMPLES);
	const maximumEvaluated = motionInteger(options.maximumEvaluatedOccurrences ?? 4_194_304, 'maximum audio evaluated occurrences', 3, 16_777_216);
	const cache = createMotionAudioWindowCache(options.provider, options.maximumCacheBytes ?? 16 * 1024 * 1024); const sample = createMotionAudioSampler();
	const assets = new Map<string, MotionAudioAsset>(revision.project.assets.flatMap((asset) => asset.kind === 'audio' || asset.kind === 'footage' ? [[asset.id, asset] as const] : []));
	const disposal = new AbortController(); let disposed = false; let rendering = false;
	return {
		revision,
		async mixBlock(value, externalSignal) {
			if (disposed) throw new Error('Motion audio mixer is disposed.'); if (rendering) throw new Error('Motion audio mixer already has one block in flight.');
			const request = normalizeMotionAudioBlockRequest(value, maximumBlock); const signal = externalSignal ? AbortSignal.any([externalSignal, disposal.signal]) : disposal.signal;
			signal.throwIfAborted();
			const maximumOccurrences = Math.min(16384, Math.floor(maximumEvaluated / (request.sampleCount + 2)));
			if (maximumOccurrences < 1) throw new RangeError('Motion audio block exceeds its evaluation work budget.');
			const interleaved = new Float32Array(request.sampleCount * request.channels); rendering = true;
			const expressionBudget = createMotionExpressionBudget({ maximumOperations: 1_000_000, signal });
			const nativeBudget = createMotionAmplitudeNativeBudget(4_194_304);
			const at = async (index: number) => {
				const query = { compositionId: request.compositionId, time: divideRationals(addRationals(request.startSample, index), request.sampleRate) };
				const audio = expressionAudio ? await expressionAudio.evaluate((prepared) => evaluator.evaluateAudio(query, maximumOccurrences, { ...prepared, expressionBudget, signal }), signal, nativeBudget)
					: evaluator.evaluateAudio(query, maximumOccurrences, { expressionBudget, signal });
				return new Map(audio.map((placement) => [placement.occurrenceId, placement]));
			};
			try {
				let previous = await at(-1); let current = await at(0);
				for (let index = 0; index < request.sampleCount; index++) {
					signal.throwIfAborted(); const next = await at(index + 1);
					for (const placement of current.values()) {
						if (placement.gain === 0) continue;
						const asset = assets.get(placement.assetId); if (!asset || (asset.kind === 'footage' && !asset.hasAudio)) throw new Error(`Missing motion audio asset ${placement.assetId}.`);
						const format = await cache.describe(asset, signal);
						const coordinate = multiplyRationals(placement.sourceTime, format.sampleRate); const position = coordinate.num / coordinate.den;
						if (position < 0 || position >= format.sampleCount) continue;
						const ratio = sourceRatio(placement, previous, next, format.sampleRate, request.sampleRate);
						if (!Number.isFinite(ratio) || ratio > 32) throw new RangeError('Motion audio source/output rate exceeds the supported 32:1 resampling budget.');
						const window = await cache.read(asset, format, position, signal); const [left, right] = sample(window, position, ratio);
						const offset = index * request.channels;
						interleaved[offset] = interleaved[offset]! + placement.gain * (request.channels === 1 ? (left + right) * 0.5 : left);
						if (request.channels === 2) interleaved[offset + 1] = interleaved[offset + 1]! + placement.gain * right;
					}
					previous = current; current = next;
				}
				signal.throwIfAborted(); if (interleaved.some((value) => !Number.isFinite(value))) throw new RangeError('Motion audio mix exceeds finite float PCM headroom.');
				return { ...request, interleaved, projectId: revision.projectId, revision: revision.revision, revisionDigest: revision.digest };
			} finally { rendering = false; }
		},
		snapshot: () => ({ cacheBytes: cache.byteLength, cacheWindows: cache.size, rendering, disposed }),
		dispose() { if (!disposed) { disposed = true; disposal.abort(); cache.clear(); if (!options.expressionAudio) expressionAudio?.dispose(); } },
	};
}

function sourceRatio(current: MotionEvaluatedAudio, previous: ReadonlyMap<string, MotionEvaluatedAudio>, next: ReadonlyMap<string, MotionEvaluatedAudio>, sourceRate: number, outputRate: number): number {
	if (current.playbackRate !== null) return Math.abs(current.playbackRate.num / current.playbackRate.den) * sourceRate / outputRate;
	const distances = [previous, next].flatMap((values) => {
		const neighbor = values.get(current.occurrenceId); if (!neighbor) return [];
		const distance = subtractRationals(neighbor.sourceTime, current.sourceTime); return [Math.abs(distance.num / distance.den) * sourceRate];
	});
	// A held remap can jump; use its stable side rather than filtering across the discontinuity.
	return distances.length === 0 ? 1 : Math.min(...distances);
}
