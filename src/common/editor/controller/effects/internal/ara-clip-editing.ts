/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AraClipEditingRuntime, AraClipPublication, AraPreparedClipEdit, AraRenderedClip,
} from '../../../ara-clip-editing-runtime.ts';
import {
	createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
} from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../../project-media-factory.ts';
import { loadSourceProvenanceDerivation } from '../../../source-provenance-derivation-loader.ts';
import type { SourceProvenanceV1 } from '../../../source-provenance.ts';
import { SOURCE_CHUNK_FRAMES } from '../../../source-pcm-contract.ts';
import { EDITOR_PROJECT_TASK_SCOPE, type EditorControllerLifetime, type EditorProjectGeneration } from '../../shared/lifecycle.ts';
import type { EffectSelectionProject } from '../effect-selection-service.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface SourceWriter {
	write(channels: Float32Array[]): Awaitable<unknown>;
	commit(metadata: Readonly<Record<string, unknown>>): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface AraClipEditingDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly getProject: () => object | null;
	readonly getCommandProject: () => EffectSelectionProject;
	readonly getSelectedClipId: () => string | null;
	readonly editingBlocked: () => boolean;
	readonly renderClip: (
		trackId: string, startFrame: number, endFrame: number, channelCount: number,
		clipIds: readonly string[], signal: AbortSignal,
	) => Promise<readonly Float32Array[]>;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly createId: (prefix: string) => string;
	readonly activateSource: (source: ReturnType<typeof createAudioSource>, signal: AbortSignal) => Promise<unknown>;
	readonly releaseSource: (sourceId: string) => Promise<unknown>;
	readonly store: Readonly<{
		beginSourceWrite(sourceId: string, metadata: Readonly<{
			name: string; mimeType: 'audio/wav'; sampleRate: number; channelCount: number; chunkFrames: number;
		}>): Promise<SourceWriter>;
		deleteSource(sourceId: string): Promise<unknown>;
	}>;
	readonly commit: (
		command: AudioEditorCommand,
		selection: Readonly<{ selectTrackId: string; selectClipId: string }>,
		behavior: Readonly<{ microfadeNewClips: false }>,
	) => unknown;
	readonly maximumPcmBytes?: number;
}

const MAXIMUM_PCM_BYTES = 128 * 1024 * 1024;

/** Render one clip, then retain edited PCM with one undoable publication. */
export function createAraClipEditingRuntime(
	dependencies: AraClipEditingDependencies,
): Readonly<AraClipEditingRuntime> {
	return Object.freeze({ prepare });

	async function prepare(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<AraPreparedClipEdit> {
		options.signal?.throwIfAborted();
		assertEditable();
		const document = dependencies.getProject();
		const project = dependencies.getCommandProject();
		const clipId = dependencies.getSelectedClipId();
		if ((project.selection?.clipIds?.length ?? 0) > 1) {
			throw new RangeError('Select one audio clip before opening an ARA plug-in.');
		}
		const clip = project.clips.find(candidate => candidate.id === clipId && candidate.kind === 'audio');
		const track = clip && project.tracks.find(candidate => candidate.type === 'audio' && candidate.clipIds?.includes(clip.id));
		const source = clip && project.sources?.find(candidate => candidate.id === clip.sourceId);
		if (!document || !clip || !track || !source) throw new RangeError('Select an audio clip before opening an ARA plug-in.');
		if (track.locked === true) throw new RangeError('The selected audio track is locked.');
		const sampleRate = integer(project.sampleRate, 8_000, 768_000, 'sample rate');
		const channelCount = integer(source.channelCount, 1, 2, 'mono/stereo channel count');
		const frameCount = integer(clip.durationFrames, 1, Number.MAX_SAFE_INTEGER, 'clip duration');
		const startFrame = integer(clip.timelineStartFrame, 0, Number.MAX_SAFE_INTEGER, 'clip start');
		const endFrame = integer(startFrame + frameCount, 1, Number.MAX_SAFE_INTEGER, 'clip end');
		const pcmBytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
		if (!Number.isSafeInteger(pcmBytes) || pcmBytes > (dependencies.maximumPcmBytes ?? MAXIMUM_PCM_BYTES)) {
			throw new RangeError('The selected clip exceeds the ARA decoded audio limit.');
		}
		const token = dependencies.projectGeneration.capture(project.id);
		const task = dependencies.lifetime.startTask('ara-clip-editing', { scope: EDITOR_PROJECT_TASK_SCOPE });
		let status: 'ready' | 'applying' | 'closed' | 'completed' = 'ready';
		const abort = (): void => task.abort(options.signal?.reason);
		options.signal?.addEventListener('abort', abort, { once: true });
		try {
			const rendered = await dependencies.renderClip(track.id, startFrame, endFrame, channelCount, [clip.id], task.signal);
			assertCurrent();
			const channels = ownedChannels(rendered, channelCount, frameCount);
			const name = typeof clip.title === 'string' && clip.title ? clip.title
				: typeof source.name === 'string' && source.name ? source.name : track.name;
			return Object.freeze({
				sourceId: clip.sourceId, name, sampleRate, channelCount, frameCount,
				sourceStartSeconds: 0, playbackStartSeconds: startFrame / sampleRate,
				durationSeconds: frameCount / sampleRate,
				channels: Object.freeze(channels), assertCurrent, apply, cancel,
			});
		} catch (error) { cancel(); throw error; }

		function assertCurrent(): void {
			if (status === 'closed' || status === 'completed') throw new Error('The ARA clip operation is closed or completed.');
			options.signal?.throwIfAborted();
			task.assertCurrent();
			dependencies.projectGeneration.assertCurrent(token);
			assertEditable();
			if (dependencies.getProject() !== document || dependencies.getSelectedClipId() !== clipId) {
				throw new Error('The selected clip or project changed during ARA editing.');
			}
		}

		function finish(): void {
			options.signal?.removeEventListener('abort', abort);
			task.finish();
		}

		function cancel(): void {
			if (status === 'closed' || status === 'completed') return;
			status = 'closed';
			task.abort();
			finish();
		}

		async function apply(result: AraRenderedClip): Promise<AraClipPublication> {
			assertCurrent();
			if (status === 'applying') throw new Error('The ARA clip result is already being applied.');
			if (!result || result.sampleRate !== sampleRate) throw new RangeError('The ARA result geometry changed sample rate.');
			const channels = ownedChannels(result.channels, channelCount, frameCount);
			status = 'applying';
			let writer: SourceWriter | null = null;
			let retained = false;
			let sourceId: string | null = null;
			try {
				sourceId = dependencies.createId('ara-source');
				await dependencies.preflightStorage(pcmBytes, 'effect');
				assertCurrent();
				const { deriveSourceProvenanceForIds } = await loadSourceProvenanceDerivation();
				assertCurrent();
				const provenance = deriveSourceProvenanceForIds(project.sources as readonly Readonly<{
					id?: unknown; provenance?: SourceProvenanceV1;
				}>[], [clip!.sourceId]);
				const name = typeof result.name === 'string' && result.name.trim()
					? result.name.trim().slice(0, 256) : `${track!.name} — ARA`;
				const source = createAudioSource({ id: sourceId, storageKey: sourceId, name: `${name}.wav`,
					mimeType: 'audio/wav', sampleRate, originalSampleRate: sampleRate,
					frameCount, channelCount, ...(provenance ? { provenance } : {}),
				});
				writer = await dependencies.store.beginSourceWrite(sourceId, {
					name: source.name, mimeType: 'audio/wav', sampleRate, channelCount, chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				assertCurrent();
				for (let frame = 0; frame < frameCount; frame += SOURCE_CHUNK_FRAMES) {
					await writer.write(channels.map(channel => channel.slice(frame, frame + SOURCE_CHUNK_FRAMES)));
					assertCurrent();
				}
				await writer.commit({ sampleRate, channelCount });
				retained = true;
				assertCurrent();
				await dependencies.activateSource(source, task.signal);
				assertCurrent();
				const trackId = dependencies.createId('ara-track');
				const outputClipId = dependencies.createId('ara-clip');
				dependencies.commit({
					type: 'batch', commands: [
						createAddSourceCommand(source),
						createAddTrackCommand(createAudioTrack({ id: trackId, name, mute: true, clipIds: [] }, sampleRate)),
						createAddClipCommand(trackId, createAudioClip({ id: outputClipId, sourceId, title: name,
							timelineStartFrame: startFrame, sourceStartFrame: 0, sourceDurationFrames: frameCount,
							durationFrames: frameCount, avLinkId: null,
						})),
						{ type: 'selection/set', startFrame: 0, endFrame: 0, trackIds: [trackId], clipIds: [outputClipId], frequencyRange: null },
					],
				}, { selectTrackId: trackId, selectClipId: outputClipId }, { microfadeNewClips: false });
				status = 'completed';
				finish();
				return Object.freeze({ trackId, clipId: outputClipId, sourceId });
			} catch (error) {
				const errors: unknown[] = [error];
				try { if (writer && !retained) await writer.abort(error); }
				catch (abortError) { errors.push(abortError); }
				try { if (retained && sourceId) await dependencies.releaseSource(sourceId); }
				catch (runtimeError) { errors.push(runtimeError); }
				try { if (retained && sourceId) await dependencies.store.deleteSource(sourceId); }
				catch (rollbackError) { errors.push(rollbackError); }
				if (status === 'applying') status = 'ready';
				if (errors.length > 1) throw new AggregateError(errors, 'ARA audio publication and rollback failed.', { cause: error });
				throw error;
			}
		}
	}

	function assertEditable(): void {
		if (dependencies.editingBlocked()) throw new Error('The project is read-only or busy.');
	}
}

function ownedChannels(value: readonly Float32Array[], channelCount: number, frameCount: number): Float32Array[] {
	if (!Array.isArray(value) || value.length !== channelCount || value.some(channel => (
		!(channel instanceof Float32Array) || channel.length !== frameCount
	))) throw new RangeError('The ARA result geometry changed channels or duration.');
	for (const channel of value) for (const sample of channel) {
		if (!Number.isFinite(sample)) throw new TypeError('ARA audio samples must be finite.');
	}
	return value.map(channel => channel.slice());
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ARA ${label} is invalid.`);
	}
	return Number(value);
}
