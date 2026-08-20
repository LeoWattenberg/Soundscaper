/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EffectSelection, EffectTarget } from './effect-selection-service.ts';
import type { EditorProjectToken } from './lifecycle.ts';

export interface NyquistGeneratedTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
}

export interface NyquistGeneratedClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

export interface NyquistGeneratedAudioProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly title: string;
	readonly sampleRate: number;
	readonly tracks: readonly NyquistGeneratedTrack[];
	readonly clips: readonly NyquistGeneratedClip[];
	readonly selection?: EffectSelection | null;
}

export interface NyquistGeneratedAudioState {
	selectedTrackId: string | null;
}

interface NyquistGeneratedAudioBuffer {
	readonly numberOfChannels: number;
	readonly length: number;
	getChannelData(index: number): Float32Array;
}

export interface NyquistSourceWriter {
	write(...args: readonly unknown[]): Promise<unknown> | unknown;
	commit(metadata: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

interface NyquistGeneratedStore {
	beginSourceWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>): Promise<NyquistSourceWriter>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteAnalysis?(key: string): Promise<unknown>;
	deleteSource(sourceId: string): Promise<unknown>;
}

interface NyquistGeneratedCopy {
	readonly effectChannelLengthsMismatch: string;
	readonly effectInvalidAudio: string;
	readonly nyquistPrompt: string;
}

export interface PersistNyquistAudioOptions {
	readonly signal?: AbortSignal | null;
	readonly name?: unknown;
	readonly trackId?: string | null;
	readonly atFrame?: unknown;
}

export interface NyquistGeneratedAudioServiceRuntime {
	readonly state: NyquistGeneratedAudioState;
	readonly copy: NyquistGeneratedCopy;
	readonly sourceChunkFrames: number;
	readonly getProject: () => NyquistGeneratedAudioProject;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly activeSelection: () => EffectSelection | null;
	readonly audacityEffectTarget: (trackId?: string | null) => EffectTarget | null;
	readonly persistAudacityEffectResult: (
		target: EffectTarget,
		type: null,
		channels: readonly Float32Array[],
		options: Readonly<{ effectName: string; signal: AbortSignal | null }>,
	) => Promise<unknown>;
	readonly matchAudacitySelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
	readonly assertAudioOutput: (channels: readonly Float32Array[]) => void;
	readonly projectSampleRate: () => number;
	readonly preflightStorage: (bytes: number, kind: 'effect') => Promise<unknown>;
	readonly createId: (prefix: string) => string;
	readonly getAudioContext: () => Promise<unknown>;
	readonly bufferFromChannels: (
		channels: readonly Float32Array[],
		sampleRate: number,
		context: unknown,
	) => Promise<NyquistGeneratedAudioBuffer>;
	readonly store: NyquistGeneratedStore;
	readonly writeBuffer: (
		writer: NyquistSourceWriter,
		buffer: NyquistGeneratedAudioBuffer,
		signal: AbortSignal | null,
	) => Promise<unknown>;
	readonly snapTimelineFrame: (frame: unknown) => number;
	readonly getPositionFrames: () => number;
	readonly cacheSourceBuffer: (sourceId: string, buffer: NyquistGeneratedAudioBuffer) => void;
	readonly generateWaveformPeaks: (
		channels: readonly Float32Array[],
		copy: NyquistGeneratedCopy,
	) => Promise<unknown>;
	readonly peakCacheKey: (sourceId: string) => string;
	readonly sourceBuffers: Map<string, unknown>;
	readonly sourcePeaks: Map<string, unknown>;
	readonly commit: (
		command: AudioEditorCommand,
		options: Readonly<{ selectTrackId: string; selectClipId: string }>,
	) => void;
}

export function createNyquistGeneratedAudioService(runtime: NyquistGeneratedAudioServiceRuntime) {
	async function persistNyquistGeneratedAudio(
		channels: readonly Float32Array[],
		options: PersistNyquistAudioOptions = {},
	): Promise<unknown> {
		const signal = options.signal ?? null;
		const project = runtime.getProject();
		const projectToken = runtime.captureProject();
		assertCurrent(runtime, projectToken, signal);
		runtime.assertAudioOutput(channels);
		if (!channels.length || !channels[0]?.length || channels.length > 2) {
			throw new Error(runtime.copy.effectInvalidAudio);
		}
		const sampleRate = runtime.projectSampleRate();
		const selection = runtime.activeSelection();
		const replacementTarget = selection ? runtime.audacityEffectTarget(options.trackId) : null;
		if (replacementTarget) {
			const result = await runtime.persistAudacityEffectResult(
				replacementTarget,
				null,
				runtime.matchAudacitySelectionChannels(channels, replacementTarget.channelCount),
				{ effectName: String(options.name || runtime.copy.nyquistPrompt), signal },
			);
			assertCurrent(runtime, projectToken, signal);
			return result;
		}
		const frameCount = channels[0].length;
		if (!channels.every((channel) => channel instanceof Float32Array && channel.length === frameCount)) {
			throw new Error(runtime.copy.effectChannelLengthsMismatch);
		}
		await runtime.preflightStorage(frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT, 'effect');
		assertCurrent(runtime, projectToken, signal);
		const sourceId = runtime.createId('nyquist-generator');
		const name = String(options.name || runtime.copy.nyquistPrompt);
		const context = await runtime.getAudioContext();
		assertCurrent(runtime, projectToken, signal);
		const buffer = await runtime.bufferFromChannels(channels, sampleRate, context);
		assertCurrent(runtime, projectToken, signal);
		const writer = await runtime.store.beginSourceWrite(sourceId, {
			name,
			mimeType: 'audio/wav',
			sampleRate,
			channelCount: channels.length,
			chunkFrames: runtime.sourceChunkFrames,
		});
		let analysisKey: string | null = null;
		try {
			assertCurrent(runtime, projectToken, signal);
			await runtime.writeBuffer(writer, buffer, signal);
			assertCurrent(runtime, projectToken, signal);
			await writer.commit({ sampleRate, channelCount: channels.length });
			assertCurrent(runtime, projectToken, signal);
			const source = {
				sampleRate,
				sampleFormat: 'float32',
				chunkFrames: runtime.sourceChunkFrames,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: channels.length,
				originalSampleRate: sampleRate,
			};
			let targetTrack = findTrack(project, options.trackId || runtime.state.selectedTrackId);
			if (targetTrack?.type !== 'audio') {
				targetTrack = project.tracks.find((track) => track.type === 'audio') ?? null;
			}
			const startFrame = runtime.snapTimelineFrame(
				options.atFrame ?? selection?.startFrame ?? runtime.getPositionFrames(),
			);
			const endFrame = startFrame + frameCount;
			const commands: AudioEditorCommand[] = [createAddSourceCommand(source)];
			let targetTrackId = targetTrack?.id ?? null;
			if (!targetTrack || targetTrack.clipIds.some((clipId) => {
				const clip = findClip(project, clipId);
				return Boolean(clip && clip.timelineStartFrame < endFrame
					&& clip.timelineStartFrame + clip.durationFrames > startFrame);
			})) {
				targetTrackId = runtime.createId('track');
				commands.push(createAddTrackCommand({
					type: 'audio', id: targetTrackId, name,
				}));
			}
			const selectedClipId = runtime.createId('clip');
			commands.push(createAddClipCommand(requireId(targetTrackId, 'track'), {
				title: name,
				sourceDurationFrames: frameCount,
				id: selectedClipId,
				sourceId,
				timelineStartFrame: startFrame,
				sourceStartFrame: 0,
				durationFrames: frameCount,
			}));
			runtime.cacheSourceBuffer(sourceId, buffer);
			const peaks = await runtime.generateWaveformPeaks(channels, runtime.copy);
			assertCurrent(runtime, projectToken, signal);
			runtime.sourcePeaks.set(sourceId, peaks);
			analysisKey = runtime.peakCacheKey(sourceId);
			await runtime.store.saveAnalysis(analysisKey, peaks);
			assertCurrent(runtime, projectToken, signal);
			runtime.commit({ type: 'batch', commands }, {
				selectTrackId: requireId(targetTrackId, 'track'),
				selectClipId: selectedClipId,
			});
			return selectedClipId;
		} catch (error) {
			await Promise.resolve(writer.abort()).catch(() => undefined);
			runtime.sourceBuffers.delete(sourceId);
			runtime.sourcePeaks.delete(sourceId);
			const key = analysisKey ?? runtime.peakCacheKey(sourceId);
			await runtime.store.deleteAnalysis?.(key).catch(() => undefined);
			await runtime.store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
	}

	return Object.freeze({ persistNyquistGeneratedAudio });
}

function assertCurrent(
	runtime: NyquistGeneratedAudioServiceRuntime,
	projectToken: EditorProjectToken,
	signal: AbortSignal | null,
): void {
	if (signal?.aborted) {
		throw signal.reason instanceof Error
			? signal.reason
			: new DOMException('The operation was cancelled.', 'AbortError');
	}
	runtime.assertProject(projectToken);
}

function findTrack(
	project: NyquistGeneratedAudioProject,
	trackId: string | null | undefined,
): NyquistGeneratedTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findClip(project: NyquistGeneratedAudioProject, clipId: string): NyquistGeneratedClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

function requireId(value: string | null, name: string): string {
	if (!value) throw new TypeError(`A ${name} id is required.`);
	return value;
}
