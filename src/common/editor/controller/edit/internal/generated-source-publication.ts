/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioBufferLike } from '../../source/source-audio.ts';
import { createNonImportedSourceProvenance } from '../../../source-provenance-root.ts';
import type { AudioGeneratorStore, AudioGeneratorWriter } from '../generator-service.ts';
import type { GeneratedSignalStream } from '../../../signal-generator-stream-client.ts';
import { SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES } from '../../../source-pcm-contract.ts';

export type GeneratedAudioSource = Readonly<Record<string, unknown>> & Readonly<{
	readonly sampleRate: number;
	readonly sampleFormat: 'float32';
	readonly chunkFrames: number;
	readonly id: string;
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: 'audio/wav';
	readonly frameCount: number;
	readonly channelCount: number;
	readonly originalSampleRate: number;
	readonly provenance: ReturnType<typeof createNonImportedSourceProvenance>;
}>;

interface GeneratedAudioSourcePublisherDependencies<Context> {
	readonly store: AudioGeneratorStore;
	readonly sourceBuffers: Readonly<{ delete(sourceId: string): unknown }>;
	readonly sourcePeaks: Readonly<{
		set(sourceId: string, peaks: unknown): unknown;
		delete(sourceId: string): unknown;
	}>;
	readonly sourceChunkFrames: number;
	getAudioContext(): Promise<Context>;
	createBuffer(
		channels: readonly Float32Array[],
		sampleRate: number,
		context: Context,
	): Promise<AudioBufferLike>;
	createEmptyBuffer?(channelCount: number, frames: number, sampleRate: number, context: Context): Promise<AudioBufferLike>;
	writeBuffer(writer: AudioGeneratorWriter, buffer: AudioBufferLike, signal: AbortSignal): Promise<unknown>;
	cacheSourceBuffer(sourceId: string, buffer: AudioBufferLike): unknown;
	generatePeaks(channels: readonly Float32Array[]): Promise<unknown>;
	peakCacheKey(sourceId: string): string;
	createId(prefix?: string): string;
}

interface GeneratedAudioSourceOwnership {
	readonly signal: AbortSignal;
	assertCurrent(): void;
}

interface GeneratedAudioSourcePublicationRequest<Prepared, Result> {
	readonly name: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly channels?: readonly Float32Array[];
	readonly stream?: GeneratedSignalStream;
	readonly ownership: GeneratedAudioSourceOwnership;
	prepare(source: GeneratedAudioSource): Prepared;
	accept(source: GeneratedAudioSource, prepared: Prepared): PromiseLike<Result> | Result;
}

/** Persist, cache, publish, and transactionally roll back one generated PCM source. */
export async function publishGeneratedAudioSource<Context, Prepared, Result>(
	dependencies: GeneratedAudioSourcePublisherDependencies<Context>,
	request: GeneratedAudioSourcePublicationRequest<Prepared, Result>,
): Promise<Result> {
	let writer: AudioGeneratorWriter | null = null;
	let sourceId: string | null = null;
	try {
		let buffer: AudioBufferLike | null = null;
		if (request.stream) {
			const bytes = request.frameCount * request.channelCount * Float32Array.BYTES_PER_ELEMENT;
			if (bytes <= SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES && dependencies.createEmptyBuffer) {
				const context = await dependencies.getAudioContext(); request.ownership.assertCurrent();
				buffer = await dependencies.createEmptyBuffer(request.channelCount, request.frameCount, request.sampleRate, context);
				request.ownership.assertCurrent();
			}
		} else {
			if (!request.channels) throw new TypeError('Generated PCM or a stream is required.');
			const context = await dependencies.getAudioContext();
			request.ownership.assertCurrent();
			buffer = await dependencies.createBuffer(request.channels, request.sampleRate, context);
			request.ownership.assertCurrent();
		}
		sourceId = dependencies.createId('generator');
		writer = await dependencies.store.beginSourceWrite(sourceId, {
			name: request.name,
			mimeType: 'audio/wav',
			sampleRate: request.sampleRate,
			channelCount: request.channelCount,
			chunkFrames: dependencies.sourceChunkFrames,
		});
		request.ownership.assertCurrent();
		if (request.stream) {
			let frames = 0;
			for await (const channels of request.stream.chunks()) {
				request.ownership.assertCurrent();
				if (channels.length !== request.channelCount || channels.some(channel => channel.length !== channels[0]!.length)
					|| frames + channels[0]!.length > request.frameCount) throw new RangeError('Generated block geometry changed.');
				if (buffer) channels.forEach((channel, index) => buffer.getChannelData(index).set(channel, frames));
				await writer.write([...channels]);
				request.ownership.assertCurrent();
				frames += channels[0]!.length;
			}
			if (frames !== request.frameCount) throw new RangeError('Generated PCM is incomplete.');
		} else {
			await dependencies.writeBuffer(writer, buffer!, request.ownership.signal);
		}
		request.ownership.assertCurrent();
		await writer.commit({ sampleRate: request.sampleRate, channelCount: request.channelCount });
		request.ownership.assertCurrent();
		const source: GeneratedAudioSource = {
			sampleRate: request.sampleRate,
			sampleFormat: 'float32',
			chunkFrames: dependencies.sourceChunkFrames,
			id: sourceId,
			storageKey: sourceId,
			name: request.name,
			mimeType: 'audio/wav',
			frameCount: request.frameCount,
			channelCount: request.channelCount,
			originalSampleRate: request.sampleRate,
			provenance: createNonImportedSourceProvenance('generated'),
		};
		const prepared = request.prepare(source);
		if (buffer) dependencies.cacheSourceBuffer(sourceId, buffer);
		const peaks = request.stream ? await request.stream.finish() : await dependencies.generatePeaks(request.channels!);
		request.ownership.assertCurrent();
		dependencies.sourcePeaks.set(sourceId, peaks);
		await dependencies.store.saveAnalysis(dependencies.peakCacheKey(sourceId), peaks);
		request.ownership.assertCurrent();
		return await request.accept(source, prepared);
	} catch (error) {
		return rollbackGeneratedAudioSource(dependencies, writer, sourceId, error);
	}
}

async function rollbackGeneratedAudioSource<Context>(
	dependencies: GeneratedAudioSourcePublisherDependencies<Context>,
	writer: AudioGeneratorWriter | null,
	sourceId: string | null,
	failure: unknown,
): Promise<never> {
	const cleanupFailures: unknown[] = [];
	if (writer) {
		try { await writer.abort(failure); }
		catch (error) { cleanupFailures.push(error); }
	}
	if (sourceId) {
		try { dependencies.sourceBuffers.delete(sourceId); }
		catch (error) { cleanupFailures.push(error); }
		try { dependencies.sourcePeaks.delete(sourceId); }
		catch (error) { cleanupFailures.push(error); }
		try { await dependencies.store.deleteSource(sourceId); }
		catch (error) { cleanupFailures.push(error); }
	}
	if (cleanupFailures.length) {
		throw new AggregateError(
			[failure, ...cleanupFailures],
			'Generated audio source publication and rollback both failed.',
			{ cause: failure },
		);
	}
	throw failure;
}
