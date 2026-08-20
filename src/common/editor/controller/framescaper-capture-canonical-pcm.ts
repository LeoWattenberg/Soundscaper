/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureStreamManifestV1 } from '../framescaper-capture-session-manifest.ts';
import type { OwnedAudioSourceWriter } from '../storage/source-write-repository.ts';
import {
	FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES,
	type TimedRawPcmSpoolChunk,
} from '../storage/raw-pcm-spool-chunk-timing.ts';
import type {
	RawPcmSpoolRecord,
	RawPcmSpoolRepository,
} from '../storage/raw-pcm-spool-repository.ts';

type RawPcmTimelinePort = Pick<RawPcmSpoolRepository, 'chunks'>;

export interface FramescaperCapturePcmTimeline {
	readonly capturedFrameCount: number;
	readonly outputFrameCount: number;
	readonly chunkCount: number;
	readonly insertedSilenceFrames: number;
}

/** Verify bounded per-chunk timing without retaining an unbounded timing array. */
export async function inspectFramescaperCapturePcmTimeline(
	spools: RawPcmTimelinePort,
	spool: RawPcmSpoolRecord,
	stream: FramescaperCaptureStreamManifestV1,
): Promise<Readonly<FramescaperCapturePcmTimeline>> {
	if (stream.storage.kind !== 'raw-pcm') throw new Error('Capture PCM timeline storage kind changed.');
	let chunkCount = 0;
	let capturedFrameCount = 0;
	let insertedSilenceFrames = 0;
	let previousEndMicroseconds: number | null = null;
	for await (const chunk of spools.chunks(spool)) {
		assertChunkTiming(chunk, chunkCount, spool.sampleRate, previousEndMicroseconds);
		const timing = chunk.timing!;
		if (chunkCount === 0) {
			if (timing.presentationTimeMicroseconds !== stream.timing.firstPresentationMicroseconds) {
				throw new Error('Capture PCM first chunk disagrees with its acknowledged presentation range.');
			}
		} else {
			insertedSilenceFrames = boundedGapSum(insertedSilenceFrames, timing.droppedFramesBefore);
		}
		chunkCount += 1;
		capturedFrameCount = exactSum(capturedFrameCount, chunk.frames, 'Capture PCM captured frame count');
		previousEndMicroseconds = exactSum(
			timing.presentationTimeMicroseconds,
			timing.durationMicroseconds,
			'Capture PCM presentation end',
		);
	}
	if (chunkCount !== spool.chunkCount || capturedFrameCount !== spool.frameCount
		|| previousEndMicroseconds !== stream.timing.lastPresentationEndMicroseconds) {
		throw new Error('Capture PCM timing does not describe its exact acknowledged prefix.');
	}
	const outputFrameCount = exactSum(
		capturedFrameCount,
		insertedSilenceFrames,
		'Capture PCM output frame count',
	);
	const first = stream.timing.firstPresentationMicroseconds;
	const end = stream.timing.lastPresentationEndMicroseconds;
	if (first === null || end === null
		|| Math.abs(end - first - frameTimeMicroseconds(outputFrameCount, spool.sampleRate)) > 2) {
		throw new Error('Capture PCM presentation range disagrees with its exact frame geometry.');
	}
	return Object.freeze({ capturedFrameCount, outputFrameCount, chunkCount, insertedSilenceFrames });
}

/** Copy captured samples unchanged and materialize exact non-pause holes as bounded zero spans. */
export async function writeFramescaperCapturePcmTimeline(
	spools: RawPcmTimelinePort,
	spool: RawPcmSpoolRecord,
	writer: OwnedAudioSourceWriter,
	expected: Readonly<FramescaperCapturePcmTimeline>,
	signal: AbortSignal | null,
): Promise<void> {
	let chunkCount = 0;
	let capturedFrameCount = 0;
	let insertedSilenceFrames = 0;
	let previousEndMicroseconds: number | null = null;
	for await (const chunk of spools.chunks(spool)) {
		throwIfAborted(signal);
		assertChunkTiming(chunk, chunkCount, spool.sampleRate, previousEndMicroseconds);
		const timing = chunk.timing!;
		if (chunkCount > 0 && timing.droppedFramesBefore > 0) {
			await writeSilence(writer, spool, timing.droppedFramesBefore, signal);
			insertedSilenceFrames = boundedGapSum(insertedSilenceFrames, timing.droppedFramesBefore);
		}
		await writer.write(chunk.channels, signal ? { signal } : {});
		chunkCount += 1;
		capturedFrameCount = exactSum(capturedFrameCount, chunk.frames, 'Capture PCM copied frame count');
		previousEndMicroseconds = exactSum(
			timing.presentationTimeMicroseconds,
			timing.durationMicroseconds,
			'Capture PCM copied presentation end',
		);
	}
	const outputFrameCount = exactSum(capturedFrameCount, insertedSilenceFrames, 'Capture PCM copied output frames');
	if (chunkCount !== expected.chunkCount || capturedFrameCount !== expected.capturedFrameCount
		|| insertedSilenceFrames !== expected.insertedSilenceFrames
		|| outputFrameCount !== expected.outputFrameCount || writer.framesWritten !== outputFrameCount) {
		throw new Error('Capture PCM publication did not consume its exact timed acknowledged prefix.');
	}
}

function assertChunkTiming(
	chunk: TimedRawPcmSpoolChunk,
	expectedIndex: number,
	sampleRate: number,
	previousEndMicroseconds: number | null,
): void {
	if (chunk.index !== expectedIndex || !chunk.timing) {
		throw new Error('Capture PCM spool emitted a missing or untimed chunk.');
	}
	const timing = chunk.timing;
	if (timing.durationMicroseconds !== frameTimeMicroseconds(chunk.frames, sampleRate)) {
		throw new Error('Capture PCM chunk duration disagrees with its frame count.');
	}
	if (expectedIndex === 0) {
		if (timing.droppedFramesBefore !== 0) {
			throw new Error('Capture PCM first chunk cannot claim a preceding internal hole.');
		}
		return;
	}
	if (previousEndMicroseconds === null || Math.abs(
		timing.presentationTimeMicroseconds - previousEndMicroseconds
		- frameTimeMicroseconds(timing.droppedFramesBefore, sampleRate),
	) > 1) {
		throw new Error('Capture PCM chunk timing disagrees with its exact dropped-frame hole.');
	}
}

async function writeSilence(
	writer: OwnedAudioSourceWriter,
	spool: RawPcmSpoolRecord,
	frames: number,
	signal: AbortSignal | null,
): Promise<void> {
	let remaining = frames;
	while (remaining > 0) {
		throwIfAborted(signal);
		const size = Math.min(remaining, spool.chunkFrames);
		const channels = Array.from({ length: spool.channelCount }, () => new Float32Array(size));
		await writer.write(channels, signal ? { signal } : {});
		remaining -= size;
	}
}

function boundedGapSum(left: number, right: number): number {
	const result = exactSum(left, right, 'Capture PCM inserted silence');
	if (result > FRAMESCAPER_CAPTURE_PCM_MAXIMUM_GAP_FRAMES) {
		throw new RangeError('Capture PCM inserted silence exceeds its strict publication bound.');
	}
	return result;
}

function frameTimeMicroseconds(frames: number, sampleRate: number): number {
	return Math.round(frames * 1_000_000 / sampleRate);
}

function exactSum(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds the safe integer range.`);
	return result;
}

function throwIfAborted(signal: AbortSignal | null): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Capture publication was cancelled.', 'AbortError');
}
