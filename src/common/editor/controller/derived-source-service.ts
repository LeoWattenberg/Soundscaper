/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import type { AudioBufferLike } from './source-audio.ts';
import {
	findControllerSource,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type DerivedSourceRecord,
	type SourceStoragePort,
	type SourceWriter,
} from './track-domain-types.ts';

interface DerivedSourceCopy {
	readonly effectInvalidAudio: string;
}

interface CachePort<Value> {
	get(key: string): Value | undefined;
	set(key: string, value: Value): unknown;
	delete(key: string): boolean;
}

interface RetiringCachePort<Value> extends Pick<CachePort<Value>, 'delete'> {
	drain(): PromiseLike<void> | void;
}

export interface DerivedSourceServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly copy: DerivedSourceCopy;
	readonly store: SourceStoragePort;
	readonly sourceBuffers: CachePort<AudioBufferLike>;
	readonly sourceChunkProviders: RetiringCachePort<unknown>;
	readonly sourcePeaks: CachePort<unknown>;
	readonly sourceChunkFrames: number;
	getProject(): ControllerProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: string): string;
	projectSampleRate(): number;
	getAudioContext(): Promise<unknown>;
	createBufferFromChannels(
		channels: Float32Array[],
		sampleRate: number,
		context: unknown,
	): Promise<AudioBufferLike>;
	loadSourceChannels(source: ControllerSource): Promise<Float32Array[]>;
	writeBuffer(writer: SourceWriter, buffer: AudioBufferLike): Promise<void>;
	generateWaveformPeaks(channels: Float32Array[]): Promise<unknown>;
	peakCacheKey(sourceId: string): string;
	cacheSourceBuffer(sourceId: string, buffer: AudioBufferLike): void;
}

export interface DerivedSourceService {
	uniqueClipSources(clips: readonly ControllerClip[]): ControllerSource[];
	sourceChannelsForEdit(source: ControllerSource): Promise<Float32Array[]>;
	persistDerivedSource(
		template: ControllerSource,
		channels: Float32Array[],
		name: string,
		idPrefix?: string,
	): Promise<DerivedSourceRecord>;
	persistRenderedMixSource(rendered: AudioBufferLike, name: string): Promise<DerivedSourceRecord>;
	rollbackDerivedSources(records: readonly Pick<DerivedSourceRecord, 'source'>[]): Promise<void>;
}

export function createDerivedSourceService(
	dependencies: DerivedSourceServiceDependencies,
): Readonly<DerivedSourceService> {
	return Object.freeze({
		uniqueClipSources,
		sourceChannelsForEdit,
		persistDerivedSource,
		persistRenderedMixSource,
		rollbackDerivedSources,
	});

	function uniqueClipSources(clips: readonly ControllerClip[]): ControllerSource[] {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		return [...new Map(clips.map((clip) => {
			const source = findControllerSource(project, clip.sourceId);
			return [source?.id, source] as const;
		})).values()].filter((source): source is ControllerSource => Boolean(source));
	}

	async function sourceChannelsForEdit(source: ControllerSource): Promise<Float32Array[]> {
		dependencies.lifetime.assertActive();
		const token = dependencies.captureProject();
		const buffer = dependencies.sourceBuffers.get(source.id);
		if (buffer) return bufferChannels(buffer);
		const channels = await dependencies.loadSourceChannels(source);
		assertOwned(token);
		return channels;
	}

	async function persistDerivedSource(
		template: ControllerSource,
		channels: Float32Array[],
		name: string,
		idPrefix = 'derived-source',
	): Promise<DerivedSourceRecord> {
		dependencies.lifetime.assertActive();
		assertChannels(channels);
		const token = dependencies.captureProject();
		const sampleRate = template.sampleRate || dependencies.projectSampleRate();
		const context = await dependencies.getAudioContext();
		assertOwned(token);
		const buffer = await dependencies.createBufferFromChannels(channels, sampleRate, context);
		assertOwned(token);
		const sourceId = dependencies.createId(idPrefix);
		const source = createDerivedSource(
			{ ...template, chunkFrames: template.chunkFrames || dependencies.sourceChunkFrames },
			channels,
			sourceId,
			name,
			sampleRate,
		);
		await persistBuffer(source, buffer, channels, token);
		return Object.freeze({ source, buffer, channels: Object.freeze(channels.slice()) });
	}

	async function persistRenderedMixSource(
		rendered: AudioBufferLike,
		name: string,
	): Promise<DerivedSourceRecord> {
		dependencies.lifetime.assertActive();
		const channels = bufferChannels(rendered);
		assertChannels(channels);
		if (channels.length > 2 || Number(rendered.sampleRate) !== dependencies.projectSampleRate()) {
			throw new Error(dependencies.copy.effectInvalidAudio);
		}
		const token = dependencies.captureProject();
		const sourceId = dependencies.createId('mixed-source');
		const sampleRate = dependencies.projectSampleRate();
		const source = createDerivedSource({
			id: sourceId,
			storageKey: sourceId,
			name,
			mimeType: 'audio/wav',
			frameCount: channels[0]!.length,
			channelCount: channels.length,
			sampleRate,
			originalSampleRate: sampleRate,
			schemaVersion: 2,
			sampleFormat: 'float32',
			opaqueExtensions: {},
			chunkFrames: dependencies.sourceChunkFrames,
		}, channels, sourceId, name, sampleRate);
		await persistBuffer(source, rendered, channels, token);
		return Object.freeze({ source, buffer: rendered, channels: Object.freeze(channels) });
	}

	async function persistBuffer(
		source: ControllerSource,
		buffer: AudioBufferLike,
		channels: Float32Array[],
		token: EditorProjectToken,
	): Promise<void> {
		let writer: SourceWriter | null = null;
		let committed = false;
		try {
			writer = await dependencies.store.beginSourceWrite(source.id, {
				name: source.name,
				mimeType: source.mimeType || 'audio/wav',
				sampleRate: source.sampleRate,
				channelCount: source.channelCount,
				chunkFrames: source.chunkFrames,
			});
			assertOwned(token);
			await dependencies.writeBuffer(writer, buffer);
			assertOwned(token);
			await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
			committed = true;
			assertOwned(token);
			dependencies.cacheSourceBuffer(source.id, buffer);
			const peaks = await dependencies.generateWaveformPeaks(channels);
			assertOwned(token);
			dependencies.sourcePeaks.set(source.id, peaks);
			await dependencies.store.saveAnalysis(dependencies.peakCacheKey(source.id), peaks);
			assertOwned(token);
		} catch (error) {
			if (!committed) await Promise.resolve(writer?.abort()).catch(() => undefined);
			try {
				await discardSource(source.id);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Derived source persistence and cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async function rollbackDerivedSources(
		records: readonly Pick<DerivedSourceRecord, 'source'>[],
	): Promise<void> {
		for (const { source } of records) await discardSource(source.id);
	}

	async function discardSource(sourceId: string): Promise<void> {
		dependencies.sourceChunkProviders.delete(sourceId);
		dependencies.sourceBuffers.delete(sourceId);
		dependencies.sourcePeaks.delete(sourceId);
		await dependencies.sourceChunkProviders.drain();
		await Promise.resolve(dependencies.store.deleteAnalysis?.(dependencies.peakCacheKey(sourceId)))
			.catch(() => undefined);
		await dependencies.store.deleteSource(sourceId).catch(() => undefined);
	}

	function assertOwned(token: EditorProjectToken): void {
		dependencies.lifetime.assertActive();
		dependencies.assertProject(token);
	}

	function assertChannels(channels: readonly Float32Array[]): void {
		if (!channels.length || !channels[0]?.length
			|| channels.some((channel) => channel.length !== channels[0]!.length)) {
			throw new Error(dependencies.copy.effectInvalidAudio);
		}
	}
}

function bufferChannels(buffer: AudioBufferLike): Float32Array[] {
	return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

function createDerivedSource(
	template: ControllerSource,
	channels: readonly Float32Array[],
	id: string,
	name: string,
	sampleRate: number,
): ControllerSource {
	return Object.freeze({
		...template,
		id,
		storageKey: id,
		name,
		frameCount: channels[0]!.length,
		channelCount: channels.length,
		sampleRate,
		originalSampleRate: template.originalSampleRate || sampleRate,
	});
}
