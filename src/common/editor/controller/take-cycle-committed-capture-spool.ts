/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	type TakeCycleCaptureSpan,
} from '../take-cycle-capture-domain.ts';
import type { StorageRecord } from '../storage/media-records.ts';
import type { SourceRepository } from '../storage/source-repository.ts';
import {
	PcmEvidenceAccumulator,
	TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES,
} from './take-cycle-capture-pcm-evidence.ts';
import type { TakeCycleSourceDescription } from './take-cycle-recording-repository-composition.ts';

export interface CommittedCaptureGeometry {
	readonly draftId: string;
	readonly loopStartSample: number;
	readonly loopSampleCount: number;
	readonly source: Omit<TakeCycleSourceDescription, 'frameCount'>;
}

type CaptureSourceReader = Pick<SourceRepository, 'chunks'>;

export function storedCaptureGeometry(
	record: StorageRecord,
	spans: readonly TakeCycleCaptureSpan[],
	seed: CommittedCaptureGeometry,
): Readonly<{ interrupted: boolean; frameCount: number }> {
	if (!spans.length) throw new RangeError('Take cycle committed capture requires at least one PCM span.');
	let expectedStart = seed.loopStartSample;
	for (const span of spans) {
		if (span.startSample !== expectedStart || span.endSample <= span.startSample
			|| span.endSample - span.startSample > seed.source.chunkFrames
			|| (span.endSample - span.startSample) * seed.source.channelCount * Float32Array.BYTES_PER_ELEMENT
				> TAKE_CYCLE_CAPTURE_MAXIMUM_CHUNK_BYTES) {
			throw new RangeError('Take cycle committed capture spans must be bounded, positive, and contiguous.');
		}
		expectedStart = span.endSample;
	}
	const frameCount = expectedStart - seed.loopStartSample;
	if (Number(record.frameCount ?? record.frameLength) !== frameCount
		|| Number(record.sampleRate) !== seed.source.sampleRate
		|| Number(record.channelCount) !== seed.source.channelCount
		|| Number(record.chunkFrames) !== seed.source.chunkFrames
		|| Number(record.chunkCount) !== spans.length) {
		throw new Error('Committed take cycle spool geometry does not match its route manifest.');
	}
	return Object.freeze({ interrupted: frameCount % seed.loopSampleCount !== 0, frameCount });
}

export async function passEvidenceFromStoredCapture(
	sources: CaptureSourceReader,
	stored: StorageRecord,
	spans: readonly TakeCycleCaptureSpan[],
	seed: CommittedCaptureGeometry,
	signal?: AbortSignal,
): Promise<readonly Readonly<{ byteLength: number; sha256: string }>[]> {
	const evidence: Readonly<{ byteLength: number; sha256: string }>[] = [];
	let accumulator: PcmEvidenceAccumulator | null = null;
	let expectedChunkIndex = 0;
	for await (const chunk of sources.chunks(seed.draftId, {
		...(signal ? { signal } : {}), expectedSource: stored,
	})) {
		throwIfAborted(signal);
		const span = spans[expectedChunkIndex];
		if (!span || Number(chunk.index) !== expectedChunkIndex
			|| chunk.frames !== span.endSample - span.startSample
			|| chunk.channels.length !== seed.source.channelCount
			|| chunk.channels.some((channel) => !(channel instanceof Float32Array)
				|| channel.length !== chunk.frames)) {
			throw new Error('Committed take cycle spool has noncanonical PCM geometry.');
		}
		let sample = span.startSample;
		let channelOffset = 0;
		while (sample < span.endSample) {
			const passIndex = Math.floor((sample - seed.loopStartSample) / seed.loopSampleCount);
			if (passIndex >= TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES) {
				throw new RangeError(`Cycle capture exceeds ${String(TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES)} passes.`);
			}
			if (!accumulator) accumulator = new PcmEvidenceAccumulator(seed.source.channelCount, seed.source.chunkFrames);
			if (passIndex !== evidence.length) throw new Error('Committed capture pass evidence lost sequential ownership.');
			const passLimit = seed.loopStartSample + (passIndex + 1) * seed.loopSampleCount;
			const length = Math.min(span.endSample, passLimit) - sample;
			accumulator.write(chunk.channels.map((channel) => channel.subarray(channelOffset, channelOffset + length)));
			sample += length;
			channelOffset += length;
			if (sample === passLimit) {
				evidence.push(accumulator.finish());
				accumulator = null;
			}
		}
		expectedChunkIndex += 1;
	}
	if (expectedChunkIndex !== spans.length) throw new Error('Committed take cycle spool is truncated.');
	if (accumulator) evidence.push(accumulator.finish());
	return Object.freeze(evidence);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new DOMException('Take cycle capture aborted.', 'AbortError');
}
