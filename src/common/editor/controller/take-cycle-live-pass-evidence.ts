/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleCaptureSpan } from '../take-cycle-capture-domain.ts';
import type { RawPcmSpoolChunk } from '../storage/raw-pcm-spool-repository.ts';
import {
	PcmEvidenceAccumulator,
	type TakeCyclePcmEvidence,
} from './take-cycle-capture-pcm-evidence.ts';

export interface TakeCycleLivePassEvidenceRequest {
	readonly chunks: AsyncIterable<RawPcmSpoolChunk>;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
	readonly loopStartSample: number;
	readonly loopEndSample: number;
	readonly passCount: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly signal?: AbortSignal;
}

/** Hash chronological passes while retaining only one bounded chunk accumulator. */
export async function collectTakeCycleLivePassEvidence(
	request: TakeCycleLivePassEvidenceRequest,
): Promise<readonly TakeCyclePcmEvidence[]> {
	const evidence: TakeCyclePcmEvidence[] = [];
	let activePassIndex = 0;
	let accumulator = new PcmEvidenceAccumulator(request.channelCount, request.chunkFrames);
	let spanIndex = 0;
	for await (const chunk of request.chunks) {
		throwIfAborted(request.signal);
		const span = request.captureSpans[spanIndex];
		if (!span || chunk.index !== spanIndex || chunk.frames !== span.endSample - span.startSample) {
			throw new Error('Live capture chunk does not match its incrementally fenced span.');
		}
		let sample = span.startSample;
		let offset = 0;
		while (sample < span.endSample) {
			const passIndex = Math.floor((sample - request.loopStartSample)
				/ (request.loopEndSample - request.loopStartSample));
			while (activePassIndex < passIndex) {
				evidence.push(accumulator.finish());
				activePassIndex += 1;
				accumulator = new PcmEvidenceAccumulator(request.channelCount, request.chunkFrames);
			}
			const passLimit = request.loopStartSample
				+ (passIndex + 1) * (request.loopEndSample - request.loopStartSample);
			const length = Math.min(span.endSample, passLimit) - sample;
			accumulator.write(chunk.channels.map((channel) => channel.subarray(offset, offset + length)));
			sample += length;
			offset += length;
		}
		spanIndex += 1;
	}
	if (spanIndex !== request.captureSpans.length) throw new Error('Live capture PCM prefix is truncated.');
	evidence.push(accumulator.finish());
	if (evidence.length !== request.passCount) throw new Error('Live capture PCM evidence does not cover every pass.');
	return Object.freeze(evidence);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: new DOMException('Take cycle recording aborted.', 'AbortError');
}
