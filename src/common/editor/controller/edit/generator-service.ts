/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../../commands/factories.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import { prepareRangeReplacementCommand as prepareLegacyRangeReplacementCommand } from '../../commands/range-runtime.js';
import type { LabeledAudioRegion } from '../../labeled-audio-regions.ts';
import { generateAudioEditorSignal } from '../../generators.js';
import { generatorName, normalizeProjectSampleRate } from '../shared/app-helpers.ts';
import {
	EditorProjectChangedError,
	type EditorControllerLifetime,
	type EditorProjectGeneration,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../shared/lifecycle.ts';
import type { AudioBufferLike } from '../source/source-audio.ts';
import { projectForAudioGeneratorCommands, type AudioGeneratorSelection, type AudioGeneratorTrack,
	type AudioGeneratorClip, type AudioGeneratorProject, type AudioGeneratorDocument } from './internal/generator-project-view.ts';
import { createLabeledAudioSilence } from './internal/labeled-audio-silence.ts';

export type AudioGeneratorType = 'silence' | 'tone' | 'chirp' | 'noise' | 'dtmf' | 'morse';

export type {
	AudioGeneratorSelection, AudioGeneratorTrack, AudioGeneratorClip, AudioGeneratorSource,
	AudioGeneratorProject, AudioGeneratorDocument,
} from './internal/generator-project-view.ts';

export interface AudioGeneratorOptions extends Readonly<Record<string, unknown>> {
	readonly atFrame?: unknown;
	readonly channelCount?: unknown;
	readonly durationSeconds?: number;
	readonly trackId?: string | null;
}

export interface AudioGeneratorEffectTarget {
	readonly channelCount: number;
	readonly durationFrames: number;
}

export interface AudioGeneratorState {
	selectedTrackId: string | null;
	readonly audacityEffectProcessing: boolean;
	lastGeneratorRequest?: AudioGeneratorRequest | null;
}

export interface AudioGeneratorRequest {
	readonly type: AudioGeneratorType;
	readonly options: AudioGeneratorOptions;
}

export interface AudioGeneratorCopy {
	readonly audioBufferUnsupported: string;
	readonly audacityProjectTooLong: string;
	readonly chirpGenerator: string;
	readonly decodedAudioEmpty: string;
	readonly decodedChannelLengthsMismatch: string;
	readonly done: string;
	readonly dtmfGenerator: string;
	readonly generatingAudio: string;
	readonly morseGenerator: string;
	readonly noiseGenerator: string;
	readonly silenceAudio: string;
	readonly silenceGenerator: string;
	readonly timeSelectionRequired: string;
	readonly toneGenerator: string;
}

export interface AudioGeneratorWriter {
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

export interface AudioGeneratorStore {
	beginSourceWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	): Promise<AudioGeneratorWriter>;
	saveAnalysis(key: string, value: unknown): Promise<unknown>;
	deleteSource(sourceId: string): Promise<unknown>;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

interface PersistEffectOptions {
	readonly effectName: string;
	readonly signal: AbortSignal;
	readonly project: AudioGeneratorDocument;
	assertCurrent(): void;
}

export interface AudioGeneratorServiceDependencies<Context = unknown, Target extends AudioGeneratorEffectTarget = AudioGeneratorEffectTarget> {
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: EditorProjectGeneration;
	readonly state: AudioGeneratorState;
	readonly copy: AudioGeneratorCopy;
	readonly store: AudioGeneratorStore;
	readonly sourceBuffers: Readonly<{
		delete(sourceId: string): unknown;
	}>;
	readonly sourcePeaks: Readonly<{
		set(sourceId: string, peaks: unknown): unknown;
		delete(sourceId: string): unknown;
	}>;
	readonly sourceChunkFrames: number;
	readonly setEffectProcessing: (processing: boolean) => void;
	getProject(): AudioGeneratorDocument;
	getCommandProject?(): AudioGeneratorProject;
	editingBlocked(): boolean;
	getPositionFrames(): number;
	snapFrame(value: unknown): number;
	trackChannelCount(
		project: AudioGeneratorDocument,
		track: AudioGeneratorTrack | null,
		fallback: number,
	): number;
	effectTargets(): readonly Target[];
	persistEffectResults(
		results: readonly Readonly<{
			target: Target;
			channels: readonly Float32Array[];
		}>[],
		type: null,
		options: PersistEffectOptions,
	): Promise<unknown>;
	preflightStorage(bytes: number, operation: 'effect'): Promise<unknown>;
	getAudioContext(): Promise<Context>;
	createBuffer(
		channels: readonly Float32Array[],
		sampleRate: number,
		context: Context,
	): Promise<AudioBufferLike>;
	writeBuffer(writer: AudioGeneratorWriter, buffer: AudioBufferLike, signal: AbortSignal): Promise<unknown>;
	cacheSourceBuffer(sourceId: string, buffer: AudioBufferLike): unknown;
	generatePeaks(channels: readonly Float32Array[]): Promise<unknown>;
	peakCacheKey(sourceId: string): string;
	createId(prefix?: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	setStatus(message: string, state?: string): void;
	publish(): void;
}

export interface AudioGeneratorService {
	generateSelectionSilence(): Promise<true | string | null>;
	generateLabeledSilence(
		regions: readonly LabeledAudioRegion[],
		trackIds: readonly string[],
	): Promise<boolean>;
	generateSignal(type: AudioGeneratorType, options?: AudioGeneratorOptions): Promise<string | null>;
	repeatLast(): Promise<string | null>;
}

export interface GeneratedSignal {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly channels: readonly Float32Array[];
}

export interface OperationOwnership {
	readonly generation: number;
	readonly project: AudioGeneratorDocument;
	readonly projectToken: EditorProjectToken;
	readonly task: EditorTaskScope;
}

export function createAudioGeneratorService<Context, Target extends AudioGeneratorEffectTarget>(
	dependencies: AudioGeneratorServiceDependencies<Context, Target>,
): Readonly<AudioGeneratorService> {
	let operationGeneration = 0;

	const labeledSilence = createLabeledAudioSilence(dependencies, Object.freeze({
		begin: beginOperation,
		assert: assertOwnership,
		markProcessing,
		finish: finishOperation,
	}));

	return Object.freeze({
		generateLabeledSilence: labeledSilence.generateLabeledSilence,
		generateSelectionSilence,
		generateSignal,
		repeatLast,
	});

	function repeatLast(): Promise<string | null> {
		const request = dependencies.state.lastGeneratorRequest;
		return request ? generateSignal(request.type, request.options) : Promise.resolve(null);
	}

	async function generateSelectionSilence(): Promise<true | string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const currentProject = dependencies.getProject();
		const selection = activeSelection(currentProject);
		if (selection) {
			return generateSignal('silence', {
				durationSeconds: (selection.endFrame - selection.startFrame)
					/ normalizeProjectSampleRate(currentProject.sampleRate),
			});
		}
		const ownership = beginOperation();
		let processing = false;
		try {
			const targets = dependencies.effectTargets();
			if (!targets.length) throw new Error(dependencies.copy.timeSelectionRequired);
			const results = targets.map((target) => ({
				target,
				channels: Object.freeze(Array.from(
					{ length: target.channelCount },
					() => new Float32Array(target.durationFrames),
				)),
			}));
			await dependencies.preflightStorage(results.reduce((sum, result) => (
				sum + result.target.durationFrames
					* result.target.channelCount
					* Float32Array.BYTES_PER_ELEMENT
			), 0), 'effect');
			assertOwnership(ownership);
			processing = markProcessing();
			await dependencies.persistEffectResults(results, null, {
				effectName: dependencies.copy.silenceAudio,
				signal: ownership.task.signal,
				project: ownership.project,
				assertCurrent: () => assertOwnership(ownership),
			});
			assertActiveProjectScope(ownership);
			dependencies.setStatus(dependencies.copy.done, 'success');
			return true;
		} finally {
			finishOperation(ownership, processing);
		}
	}

	async function generateSignal(
		type: AudioGeneratorType,
		options: AudioGeneratorOptions = {},
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const ownership = beginOperation();
		let processing = false;
		let writer: AudioGeneratorWriter | null = null;
		let sourceId: string | null = null;
		try {
			const project = ownership.project;
			const selection = activeSelection(project);
			let targetTrack = findTrack(project, options.trackId || dependencies.state.selectedTrackId);
			if (targetTrack?.type !== 'audio') {
				targetTrack = project.tracks.find((track) => track.type === 'audio') ?? null;
			}
			const sampleRate = normalizeProjectSampleRate(project.sampleRate);
			const durationSeconds = options.durationSeconds
				?? (selection ? (selection.endFrame - selection.startFrame) / sampleRate : 30);
			const channelCount = Number(options.channelCount
				|| dependencies.trackChannelCount(project, targetTrack, project.masterChannels || 2));
			const generated = generateAudioEditorSignal(type, {
				...options,
				durationSeconds,
				sampleRate,
				channelCount,
			}) as GeneratedSignal;
			await dependencies.preflightStorage(
				generated.frameCount * generated.channelCount * Float32Array.BYTES_PER_ELEMENT,
				'effect',
			);
			assertOwnership(ownership);
			processing = markProcessing();
			const context = await dependencies.getAudioContext();
			assertOwnership(ownership);
			const buffer = await dependencies.createBuffer(generated.channels, sampleRate, context);
			assertOwnership(ownership);
			sourceId = dependencies.createId('generator');
			const name = generatorName(type, dependencies.copy);
			writer = await dependencies.store.beginSourceWrite(sourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate,
				channelCount,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			assertOwnership(ownership);
			await dependencies.writeBuffer(writer, buffer, ownership.task.signal);
			assertOwnership(ownership);
			await writer.commit({ sampleRate, channelCount });
			assertOwnership(ownership);
			const source = {
				sampleRate,
				sampleFormat: 'float32',
				chunkFrames: dependencies.sourceChunkFrames,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: generated.frameCount,
				channelCount,
				originalSampleRate: sampleRate,
			};
			const prepared = prepareGeneratorCommand(
				project,
				selection,
				targetTrack,
				generated.frameCount,
				source,
				name,
				options,
			);
			assertOwnership(ownership);
			dependencies.cacheSourceBuffer(sourceId, buffer);
			const peaks = await dependencies.generatePeaks(generated.channels);
			assertOwnership(ownership);
			dependencies.sourcePeaks.set(sourceId, peaks);
			await dependencies.store.saveAnalysis(dependencies.peakCacheKey(sourceId), peaks);
			assertOwnership(ownership);
			dependencies.commit(prepared.command, {
				selectTrackId: prepared.trackId,
				selectClipId: prepared.clipId,
			});
			dependencies.state.lastGeneratorRequest = Object.freeze({
				type,
				options: Object.freeze({ ...options }),
			});
			dependencies.setStatus(dependencies.copy.done, 'success');
			return prepared.clipId;
		} catch (error) {
			if (writer) await Promise.resolve(writer.abort(error)).catch(() => undefined);
			if (sourceId) {
				dependencies.sourceBuffers.delete(sourceId);
				dependencies.sourcePeaks.delete(sourceId);
				await dependencies.store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		} finally {
			finishOperation(ownership, processing);
		}
	}

	function prepareGeneratorCommand(
		persistedProject: AudioGeneratorDocument,
		selection: AudioGeneratorSelection | null,
		targetTrack: AudioGeneratorTrack | null,
		frameCount: number,
		source: Readonly<Record<string, unknown>>,
		name: string,
		options: AudioGeneratorOptions,
	): Readonly<{ command: AudioEditorCommand; trackId: string; clipId: string }> {
		const project = projectForAudioGeneratorCommands(persistedProject, dependencies.getCommandProject);
		if (selection && targetTrack?.type === 'audio') {
			const replacement = prepareLegacyRangeReplacementCommand(project, {
				trackId: targetTrack.id,
				startFrame: selection.startFrame,
				endFrame: selection.endFrame,
				source,
			}, dependencies.createId) as unknown as Extract<AudioEditorCommand, { readonly type: 'range/replace' }>;
			return { command: replacement, trackId: targetTrack.id, clipId: replacement.clipId };
		}

		const startFrame = dependencies.snapFrame(
			options.atFrame ?? selection?.startFrame ?? dependencies.getPositionFrames(),
		);
		const endFrame = startFrame + frameCount;
		const commands: AudioEditorCommand[] = [createAddSourceCommand(source)];
		let trackId = targetTrack?.id ?? '';
		if (!targetTrack || (targetTrack.clipIds ?? []).some((clipId) => {
			const clip = findClip(project, clipId);
			return Boolean(clip
				&& clip.timelineStartFrame < endFrame
				&& clip.timelineStartFrame + clip.durationFrames > startFrame);
		})) {
			trackId = dependencies.createId('track');
			commands.push(createAddTrackCommand({
				type: 'audio',
				id: trackId,
				name,
			}));
		}
		const clipId = dependencies.createId('clip');
		commands.push(createAddClipCommand(trackId, {
			title: name,
			sourceDurationFrames: frameCount,
			id: clipId,
			sourceId: String(source.id),
			timelineStartFrame: startFrame,
			sourceStartFrame: 0,
			durationFrames: frameCount,
		}));
		return { command: { type: 'batch', commands }, trackId, clipId };
	}

	function beginOperation(): OperationOwnership {
		const project = dependencies.getProject();
		const projectToken = dependencies.projectGeneration.capture(project.id);
		const task = dependencies.lifetime.startTask('audio:generation');
		return Object.freeze({ generation: ++operationGeneration, project, projectToken, task });
	}

	function assertOwnership(ownership: OperationOwnership): void {
		ownership.task.assertCurrent();
		dependencies.projectGeneration.assertCurrent(ownership.projectToken);
		if (dependencies.getProject() !== ownership.project) throw new EditorProjectChangedError();
	}

	function assertActiveProjectScope(ownership: OperationOwnership): void {
		ownership.task.assertCurrent();
		dependencies.projectGeneration.assertCurrent(ownership.projectToken);
		if (dependencies.getProject().id !== ownership.project.id) throw new EditorProjectChangedError();
	}

	function markProcessing(): true {
		dependencies.setEffectProcessing(true);
		dependencies.setStatus(dependencies.copy.generatingAudio);
		dependencies.publish();
		return true;
	}

	function finishOperation(ownership: OperationOwnership, processing: boolean): void {
		ownership.task.finish();
		if (processing && ownership.generation === operationGeneration) {
			dependencies.setEffectProcessing(false);
			if (!dependencies.lifetime.inactive) dependencies.publish();
		}
	}
}

function activeSelection(project: AudioGeneratorDocument): AudioGeneratorSelection | null {
	const selection = project.selection;
	return selection && selection.endFrame > selection.startFrame ? selection : null;
}

function findTrack(
	project: AudioGeneratorDocument,
	trackId: string | null | undefined,
): AudioGeneratorTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findClip(
	project: AudioGeneratorProject,
	clipId: string | null | undefined,
): AudioGeneratorClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}
