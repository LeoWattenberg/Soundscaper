/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	clipNeedsTimePitchRender as legacyClipNeedsTimePitchRender,
} from '../clip-time-pitch-cache.js';
import {
	createAddClipCommand,
	createAddSourceCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { ClipTimePitchCacheEntry } from './clip-time-pitch-service.ts';
import type {
	ClipTransformClip,
	ClipTransformProject,
	ClipTransformSource,
	ClipTransformTrack,
} from './clip-domain-types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import { audioBufferChannels, type AudioBufferLike } from './source-audio.ts';

interface ClipTimePitchRenderCopy {
	readonly audioClipNotFound: string;
	readonly rendering: string;
	readonly renderPitchSpeed: string;
	readonly done: string;
}

export interface ClipTimePitchSourceWriter {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

export interface ClipTimePitchRenderStore {
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	): Promise<ClipTimePitchSourceWriter>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteAnalysis?(key: string): Promise<unknown>;
	deleteSource(sourceId: string): Promise<unknown>;
}

interface RenderClip extends ClipTransformClip {
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly preserveFormants: boolean;
	readonly renderCacheRevision: number;
}

interface RenderSource extends ClipTransformSource {
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
}

interface RenderFingerprint {
	readonly projectId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly reversed: boolean;
	readonly renderCacheRevision: number;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

interface MutableCache<Value> {
	set(key: string, value: Value): unknown;
	delete(key: string): boolean;
}

export interface ClipTimePitchRenderServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: ClipTimePitchRenderCopy;
	readonly store: ClipTimePitchRenderStore;
	readonly sourceBuffers: Pick<MutableCache<AudioBufferLike>, 'delete'>;
	readonly sourcePeaks: MutableCache<unknown>;
	readonly sourceChunkFrames: number;
	getProject(): ClipTransformProject;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	prepareCommittedOutput(
		clip: ClipTransformClip,
		source: ClipTransformSource,
		options: Readonly<{ signal: AbortSignal }>,
	): Promise<ClipTimePitchCacheEntry>;
	materializeEntry(
		entry: ClipTimePitchCacheEntry,
		signal: AbortSignal,
	): Promise<ClipTimePitchCacheEntry>;
	preflightStorage(bytes: number, purpose: 'effect'): Promise<unknown>;
	createId(prefix: string): string;
	writeBuffer(
		writer: ClipTimePitchSourceWriter,
		buffer: AudioBufferLike,
		signal: AbortSignal,
	): Promise<void>;
	generateWaveformPeaks(
		channels: readonly Float32Array[],
		signal: AbortSignal,
	): Promise<unknown>;
	peakCacheKey(sourceId: string): string;
	cacheSourceBuffer(sourceId: string, buffer: AudioBufferLike): void;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	setProcessing(processing: boolean): void;
	setStatus(message: string, kind?: string): void;
	publish(): void;
}

export interface ClipTimePitchRenderService {
	renderClipPitchSpeed(clipId?: string | null): Promise<string | null>;
}

export function createClipTimePitchRenderService(
	dependencies: ClipTimePitchRenderServiceDependencies,
): Readonly<ClipTimePitchRenderService> {
	let renderGeneration = 0;
	return Object.freeze({ renderClipPitchSpeed });

	async function renderClipPitchSpeed(
		clipId: string | null = dependencies.getSelectedClipId(),
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findRenderClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		const source = clip ? findRenderSource(project, clip.sourceId) : null;
		if (!clip || !track || !source) throw new Error(dependencies.copy.audioClipNotFound);
		if (!clipNeedsTimePitchRender(clip)) return clip.id;
		const task = dependencies.lifetime.startTask('clip-time-pitch-render');
		const operation = ++renderGeneration;
		const projectToken = dependencies.captureProject();
		const fingerprint = fingerprintClip(project, clip);
		dependencies.setProcessing(true);
		dependencies.setStatus(dependencies.copy.rendering);
		dependencies.publish();
		let renderedSourceId: string | null = null;
		let writer: ClipTimePitchSourceWriter | null = null;
		let writerCommitted = false;
		try {
			const entry = await dependencies.prepareCommittedOutput(clip, source, { signal: task.signal });
			assertOwned(task, projectToken, fingerprint);
			const materialized = await dependencies.materializeEntry(entry, task.signal);
			assertOwned(task, projectToken, fingerprint);
			const buffer = materialized.audioBuffer;
			if (!buffer) throw new Error('The committed time/pitch cache did not materialize audio.');
			const channels = audioBufferChannels(buffer).map((channel) => channel.slice());
			await dependencies.preflightStorage(
				buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
				'effect',
			);
			assertOwned(task, projectToken, fingerprint);
			renderedSourceId = dependencies.createId('rendered-clip');
			const name = `${source.name || clip.title || track.name} — ${dependencies.copy.renderPitchSpeed}`;
			writer = await dependencies.store.beginSourceWrite(renderedSourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate: buffer.sampleRate,
				channelCount: buffer.numberOfChannels,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			assertOwned(task, projectToken, fingerprint);
			await dependencies.writeBuffer(writer, buffer, task.signal);
			assertOwned(task, projectToken, fingerprint);
			await writer.commit({
				sampleRate: buffer.sampleRate,
				channelCount: buffer.numberOfChannels,
			});
			writerCommitted = true;
			assertOwned(task, projectToken, fingerprint);
			const nextSource = renderedSource(source, renderedSourceId, name, buffer);
			const nextClip = renderedClip(clip, renderedSourceId, buffer.length);
			dependencies.cacheSourceBuffer(renderedSourceId, buffer);
			const peaks = await dependencies.generateWaveformPeaks(channels, task.signal);
			assertOwned(task, projectToken, fingerprint);
			dependencies.sourcePeaks.set(renderedSourceId, peaks);
			await dependencies.store.saveAnalysis(dependencies.peakCacheKey(renderedSourceId), peaks);
			assertOwned(task, projectToken, fingerprint);
			dependencies.commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(nextSource),
					{ type: 'clip/remove', clipId: clip.id },
					createAddClipCommand(track.id, nextClip),
				],
			}, { selectTrackId: track.id, selectClipId: clip.id });
			dependencies.setStatus(dependencies.copy.done, 'success');
			return clip.id;
		} catch (error) {
			if (writer && !writerCommitted) await Promise.resolve(writer.abort(error)).catch(() => undefined);
			if (renderedSourceId) await discardRenderedSource(renderedSourceId);
			throw error;
		} finally {
			if (operation === renderGeneration) {
				dependencies.setProcessing(false);
				dependencies.publish();
			}
			task.finish();
		}
	}

	async function discardRenderedSource(sourceId: string): Promise<void> {
		dependencies.sourceBuffers.delete(sourceId);
		dependencies.sourcePeaks.delete(sourceId);
		await Promise.resolve(dependencies.store.deleteAnalysis?.(dependencies.peakCacheKey(sourceId)))
			.catch(() => undefined);
		await dependencies.store.deleteSource(sourceId).catch(() => undefined);
	}

	function assertOwned(
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
		fingerprint: RenderFingerprint,
	): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
		const active = findRenderClip(dependencies.getProject(), fingerprint.clipId);
		if (!active || !matchesFingerprint(active, fingerprint)) {
			throw new DOMException('The clip changed before rendering completed.', 'AbortError');
		}
	}
}

function renderedSource(
	source: RenderSource,
	id: string,
	name: string,
	buffer: AudioBufferLike,
): RenderSource {
	return {
		...source,
		id,
		storageKey: id,
		name,
		frameCount: buffer.length,
		channelCount: buffer.numberOfChannels,
		sampleRate: buffer.sampleRate,
		originalSampleRate: source.originalSampleRate || source.sampleRate,
	};
}

function renderedClip(clip: RenderClip, sourceId: string, frameCount: number): RenderClip {
	return {
		...clip,
		sourceId,
		sourceStartFrame: 0,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
		pitchCents: 0,
		speedRatio: 1,
		preserveFormants: false,
		reversed: false,
		fadeInFrames: Math.min(clip.fadeInFrames, frameCount),
		fadeOutFrames: Math.min(clip.fadeOutFrames, frameCount),
		renderCacheRevision: 0,
	};
}

function fingerprintClip(project: ClipTransformProject, clip: RenderClip): RenderFingerprint {
	return Object.freeze({
		projectId: project.id,
		clipId: clip.id,
		sourceId: clip.sourceId,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		pitchCents: clip.pitchCents,
		speedRatio: clip.speedRatio,
		reversed: clip.reversed,
		renderCacheRevision: clip.renderCacheRevision,
	});
}

function matchesFingerprint(clip: RenderClip, value: RenderFingerprint): boolean {
	return clip.id === value.clipId
		&& clip.sourceId === value.sourceId
		&& clip.sourceStartFrame === value.sourceStartFrame
		&& clip.sourceDurationFrames === value.sourceDurationFrames
		&& clip.durationFrames === value.durationFrames
		&& clip.pitchCents === value.pitchCents
		&& clip.speedRatio === value.speedRatio
		&& clip.reversed === value.reversed
		&& clip.renderCacheRevision === value.renderCacheRevision;
}

function findRenderClip(
	project: ClipTransformProject,
	clipId: string | null | undefined,
): RenderClip | null {
	return (project.clips.find((clip) => clip.id === clipId) as RenderClip | undefined) ?? null;
}

function findRenderSource(project: ClipTransformProject, sourceId: string): RenderSource | null {
	return (project.sources.find((source) => source.id === sourceId) as RenderSource | undefined) ?? null;
}

function findClipTrack(project: ClipTransformProject, clipId: string): ClipTransformTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

function clipNeedsTimePitchRender(clip: RenderClip): boolean {
	return (legacyClipNeedsTimePitchRender as (clip: RenderClip) => boolean)(clip);
}
