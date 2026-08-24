/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact float32 WAV carrier streamed by the common bounded PCM engine. */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { applyMediaChannelMapping } from '../common/editor/media-export.js';
import type { FramescaperNativeRenderInputV1 } from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { createWavStreamEncoder, inspectWavLayout } from '../common/editor/wav.js';
import {
	createFramescaperNativeOpfsByteSpool,
	type FramescaperNativeOpfsByteSpool,
} from './native-render-opfs-spool.ts';

const MAXIMUM_AUDIO_BYTES = 16 * 1_024 ** 4;
const MAXIMUM_WRITE_BYTES = 4 * 1_024 ** 2;

export interface FramescaperNativeAudioCarrierStreamSinkV28 {
	write(bytes: Uint8Array): PromiseLike<void> | void;
}

export interface FramescaperNativeAudioCarrierStreamResultV28 {
	readonly byteLength: number;
	readonly sha256: string;
	readonly chunkCount: number;
}

export interface FramescaperNativeAudioCarrierOptionsV28 {
	readonly createSpool?: (
		maximumChunkBytes: number, expectedByteLength: number, signal: AbortSignal,
	) => PromiseLike<FramescaperNativeOpfsByteSpool> | FramescaperNativeOpfsByteSpool;
}

export async function createFramescaperNativeAudioCarrierV28(
	plan: UnifiedExactRenderPlanV14,
	project: Readonly<Record<string, unknown>>,
	operation: ProductNativeRenderInputOperation,
	options: FramescaperNativeAudioCarrierOptionsV28 = {},
): Promise<FramescaperNativeRenderInputV1 | null> {
	if (!plan.output.includeAudio) return null;
	const expectedByteLength = framescaperNativeAudioCarrierV28ByteLength(plan, project);
	assertReady(operation);
	const createSpool = options.createSpool ?? createFramescaperNativeOpfsByteSpool;
	const spool = await createSpool(MAXIMUM_WRITE_BYTES, expectedByteLength, operation.signal);
	try {
		const streamed = await streamFramescaperNativeAudioCarrierV28(
			plan, project, operation, { write: (bytes) => spool.write(bytes) },
		);
		const completed = await spool.complete('audio/wav');
		if (completed.byteLength !== streamed.byteLength || completed.sha256 !== streamed.sha256) {
			throw new Error('Selected V28 durable audio spool changed its live stream identity.');
		}
		return Object.freeze({
			role: 'staged-audio-mix', byteLength: completed.byteLength,
			sha256: completed.sha256, bytes: completed.bytes,
		});
	} catch (error) {
		try { await spool.abort(); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'V28 PCM rendering and spool cleanup failed.', { cause: error });
		}
		throw error;
	}
}

/** Determine the trailer-authenticated audio reservation without rendering PCM. */
export function framescaperNativeAudioCarrierV28ByteLength(
	plan: UnifiedExactRenderPlanV14,
	project: Readonly<Record<string, unknown>>,
): number {
	const audioLayout = exactAudioLayout(plan);
	const channelCount = outputChannelCount(project, audioLayout);
	const layout = inspectWavLayout({
		sampleRate: plan.timebase.sampleRate, channelCount,
		totalFrames: plan.timebase.sampleDuration, bitDepth: 32, float: true,
	});
	if (!Number.isSafeInteger(layout.byteLength) || layout.byteLength > MAXIMUM_AUDIO_BYTES) {
		throw new RangeError('Selected V28 float32 WAV exceeds its 16 TiB live reservation.');
	}
	return layout.byteLength;
}

/** Stream float32 WAV directly into the acknowledged main/helper input reservation. */
export async function streamFramescaperNativeAudioCarrierV28(
	plan: UnifiedExactRenderPlanV14,
	project: Readonly<Record<string, unknown>>,
	operation: ProductNativeRenderInputOperation,
	sink: FramescaperNativeAudioCarrierStreamSinkV28,
): Promise<FramescaperNativeAudioCarrierStreamResultV28> {
	if (!sink || typeof sink.write !== 'function' || typeof operation.renderAudioToSink !== 'function') {
		throw new Error('Selected V28 bounded PCM stream authority is unavailable.');
	}
	const audioLayout = exactAudioLayout(plan);
	const channelCount = outputChannelCount(project, audioLayout);
	const byteLength = framescaperNativeAudioCarrierV28ByteLength(plan, project);
	const hash = sha256.create();
	let chunkCount = 0;
	let writeTail = Promise.resolve();
	const encoder = createWavStreamEncoder({
		sampleRate: plan.timebase.sampleRate, channelCount,
		totalFrames: plan.timebase.sampleDuration, bitDepth: 32, float: true,
		dither: 'none', collect: false,
		onChunk(chunk: Uint8Array) {
			hash.update(chunk); chunkCount += 1;
			writeTail = writeTail.then(async () => { await sink.write(chunk); });
			return writeTail;
		},
	});
	let frameOffset = 0;
	await writeTail;
	const result = await operation.renderAudioToSink(project, renderRange(plan), async (channels, metadata) => {
		assertReady(operation);
		const frames = exactPcmChunk(channels, metadata, frameOffset, plan.timebase.sampleRate);
		const mapped = applyMediaChannelMapping([...channels], audioLayout);
		if (mapped.length !== channelCount || mapped.some((channel) => channel.length !== frames)) {
			throw new Error('Selected V28 PCM mapping changed exact channel geometry.');
		}
		encoder.write(mapped); frameOffset += frames;
		await writeTail;
		for (const channel of mapped) channel.fill(0);
	});
	assertReady(operation);
	if (result.sampleRate !== plan.timebase.sampleRate
		|| result.frameCount !== plan.timebase.sampleDuration || frameOffset !== result.frameCount
		|| result.channelCount < 1 || result.channelCount > 32 || result.chunkCount < 1) {
		throw new Error('Selected V28 audio streaming changed exact render geometry.');
	}
	const finalized = encoder.finalize();
	await encoder.settled(); await writeTail;
	if (!finalized || typeof finalized !== 'object' || finalized.byteLength !== byteLength
		|| encoder.byteLength !== byteLength) {
		throw new Error('Selected V28 float32 WAV length changed.');
	}
	return Object.freeze({ byteLength, sha256: bytesToHex(hash.digest()), chunkCount });
}

function exactAudioLayout(plan: UnifiedExactRenderPlanV14): 'mono' | 'stereo' | 'preserve' {
	if (!plan.output.includeAudio || plan.codecs.audio !== 'pcm_s16le'
		|| plan.codecs.audioEncoder !== 'pcm_s16le' || plan.output.audioLayout === null) {
		throw new Error('Selected V28 audio carrier is not bound to exact PCM/MOV authority.');
	}
	return plan.output.audioLayout;
}

function renderRange(plan: UnifiedExactRenderPlanV14): Readonly<Record<string, unknown>> {
	return Object.freeze({
		startFrame: plan.timebase.sampleStart,
		endFrame: plan.timebase.sampleStart + plan.timebase.sampleDuration,
		includeTail: false, outputFrames: plan.timebase.sampleDuration,
		preRollFrames: Math.min(plan.timebase.sampleStart, plan.timebase.sampleRate * 10),
		sampleRate: plan.timebase.sampleRate, chunkFrames: 4_096,
	});
}

function outputChannelCount(project: Readonly<Record<string, unknown>>, layout: 'mono' | 'stereo' | 'preserve'): number {
	const masterChannels = Number(project.masterChannels);
	if (!Number.isSafeInteger(masterChannels) || masterChannels < 1 || masterChannels > 32) {
		throw new RangeError('Selected V28 audio project has invalid master-channel geometry.');
	}
	return layout === 'mono' ? 1 : layout === 'stereo' ? 2 : masterChannels;
}

function exactPcmChunk(
	channels: readonly Float32Array[],
	metadata: Readonly<{ readonly frameOffset?: number; readonly sampleRate: number; readonly frames?: number }>,
	expectedOffset: number,
	expectedSampleRate: number,
): number {
	if (!Array.isArray(channels) || channels.length < 1 || channels.length > 32
		|| channels.some((channel) => !(channel instanceof Float32Array))
		|| channels.some((channel) => channel.length !== channels[0]!.length)
		|| channels[0]!.length < 1 || metadata.sampleRate !== expectedSampleRate
		|| metadata.frameOffset !== expectedOffset
		|| (metadata.frames !== undefined && metadata.frames !== channels[0]!.length)) {
		throw new Error('Selected V28 audio renderer emitted a non-dense PCM chunk.');
	}
	return channels[0]!.length;
}

function assertReady(operation: ProductNativeRenderInputOperation): void {
	if (operation.signal.aborted) throw operation.signal.reason
		?? new DOMException('V28 audio carrier production was cancelled.', 'AbortError');
	operation.assertCurrent();
}
