/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { DerivedSourceService } from './derived-source-service.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import {
	createMixRenderPlan,
	createMixRenderSnapshot,
	mixRenderOutputChannelCount,
	mixRenderTailFrames,
	prepareMixRenderCommit,
	selectAudioTracksForMix,
} from './mix-render-model.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type {
	ControllerEffect,
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
	MutableControllerProject,
	SourceStoragePort,
	SourceWriter,
} from './track-domain-types.ts';

const MIX_RENDER_TASK = 'mix-render';

interface MixRenderCopy {
	readonly v2Required: string;
	readonly mixRenderRequiresAudio: string;
	readonly audacitySelectionHint: string;
	readonly audioTrackRequired: string;
	readonly rendering: string;
	readonly mixedTrack: string;
	readonly mixRender: string;
	readonly mixdownTo: string;
	readonly effectInvalidAudio: string;
	readonly done: string;
}

interface StreamingSourceWriter {
	readonly channelCount: number;
	readonly framesWritten: number;
	write(channels: Float32Array[]): Promise<unknown> | unknown;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<unknown>;
	abort(reason?: unknown): Promise<unknown> | unknown;
}

interface MixRenderEngine {
	loadProject(project: ControllerProject, sourceBuffers: unknown): void;
	renderMixToSink(options: Readonly<Record<string, unknown>>): Promise<Readonly<{
		sampleRate?: unknown;
		channelCount?: unknown;
		frameCount?: unknown;
	}>>;
	dispose(): Promise<unknown> | unknown;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface MixRenderServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: MixRenderCopy;
	readonly derivedSources: DerivedSourceService;
	readonly store: Pick<SourceStoragePort, 'beginSourceWrite'>;
	readonly sourceBuffers: unknown;
	readonly sourceChunkFrames: number;
	readonly memoryLimitBytes: number;
	getProject(): ControllerProject;
	getSelectedTrackId(): string | null;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	preflightStorage(bytes: number, category: 'effect'): Promise<unknown>;
	setProcessing(processing: boolean): void;
	setStatus(message: string, state?: string): void;
	publish(): void;
	handleError(error: unknown): void;
	rackTailFrames(
		effects: readonly ControllerEffect[],
		sampleRate: number,
		maximumSeconds: number,
	): number;
	isFixedStereoEffect(type: string): boolean;
	renderSnapshot(project: ControllerProject, options: Readonly<Record<string, unknown>>): Promise<AudioBufferLike>;
	getAudioContext(): Promise<unknown>;
	createBufferFromChannels(
		channels: Float32Array[],
		sampleRate: number,
		context: unknown,
	): Promise<AudioBufferLike>;
	createRenderEngine(): MixRenderEngine;
	createStreamingWriter(writer: SourceWriter): StreamingSourceWriter;
	prepareCommittedTimePitchCaches(project: ControllerProject): Promise<unknown>;
	activateStoredSource(source: ControllerSource, metadata: unknown): Promise<unknown>;
}

export interface MixRenderService {
	mixAndRenderTracks(): Promise<Readonly<{
		trackId: string;
		clipId: string;
		sourceId: string;
	}> | null>;
}

interface MixOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

export function createMixRenderService(
	dependencies: MixRenderServiceDependencies,
): Readonly<MixRenderService> {
	return Object.freeze({ mixAndRenderTracks });

	async function mixAndRenderTracks(): Promise<Readonly<{
		trackId: string;
		clipId: string;
		sourceId: string;
	}> | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		if (project.schemaVersion < 2) throw new Error(dependencies.copy.v2Required);
		const targetTracks = selectAudioTracksForMix(
			project,
			dependencies.getSelectedTrackId(),
			dependencies.getSelectedClipId(),
		);
		const renderProject = createMixRenderSnapshot(project, targetTracks);
		const tailFrames = mixRenderTailFrames(
			targetTracks,
			renderProject,
			project.sampleRate,
			dependencies.rackTailFrames,
		);
		const plan = createMixRenderPlan(project, targetTracks, tailFrames, dependencies.memoryLimitBytes);
		if (!plan) throw new Error(dependencies.copy.mixRenderRequiresAudio
			|| dependencies.copy.audacitySelectionHint || dependencies.copy.audioTrackRequired);
		const ownership = {
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(MIX_RENDER_TASK),
		};
		dependencies.setProcessing(true);
		dependencies.setStatus(dependencies.copy.rendering);
		dependencies.publish();
		let renderedSource: DerivedSourceRecord | null = null;
		let published = false;
		try {
			await dependencies.preflightStorage(plan.outputBytes, 'effect');
			assertOwned(ownership);
			const mixName = targetTracks.length === 1
				? targetTracks[0]!.name
				: dependencies.copy.mixedTrack || 'Mix';
			const sourceName = `${mixName} — ${dependencies.copy.mixRender
				|| dependencies.copy.mixdownTo || 'Mix and render'}.wav`;
			if (plan.streamToStorage) {
				renderedSource = await persistStreamedMixSource(renderProject, sourceName, plan, ownership);
			} else {
				const rendered = await dependencies.renderSnapshot(renderProject, {
					startFrame: plan.startFrame,
					endFrame: plan.endFrame,
					includeTail: plan.tailFrames ? plan.tailFrames / project.sampleRate : false,
					includeMaster: false,
					includeTrackPan: true,
					respectMuteSolo: false,
					preRollFrames: plan.preRollFrames,
				});
				assertOwned(ownership);
				const channelCount = mixRenderOutputChannelCount(
					project,
					targetTracks,
					renderProject,
					rendered,
					dependencies.isFixedStereoEffect,
				);
				const normalized = await normalizeMixOutput(rendered, channelCount, ownership);
				renderedSource = await dependencies.derivedSources.persistRenderedMixSource(normalized, sourceName);
				assertOwned(ownership);
			}
			const prepared = prepareMixRenderCommit(project, targetTracks, renderedSource.source, {
				startFrame: plan.startFrame,
				mixName,
				createId: dependencies.createId,
			});
			assertOwned(ownership);
			dependencies.commit(prepared.command, {
				selectTrackId: prepared.trackId,
				selectClipId: prepared.clipId,
			});
			published = true;
			dependencies.setStatus(dependencies.copy.done, 'success');
			return Object.freeze({
				trackId: prepared.trackId,
				clipId: prepared.clipId,
				sourceId: renderedSource.source.id,
			});
		} catch (error) {
			if (renderedSource && !published) {
				await dependencies.derivedSources.rollbackDerivedSources([renderedSource]);
			}
			if (isOwned(ownership)) dependencies.handleError(error);
			throw error;
		} finally {
			if (taskIsCurrent(ownership.task)) {
				dependencies.setProcessing(false);
				if (projectIsCurrent(ownership.project)) dependencies.publish();
				ownership.task.finish();
			}
		}
	}

	async function normalizeMixOutput(
		rendered: AudioBufferLike,
		outputChannelCount: 1 | 2,
		ownership: MixOwnership,
	): Promise<AudioBufferLike> {
		const channels = bufferChannels(rendered);
		if (!channels.length || channels.length > 2 || !channels[0]?.length
			|| channels.some((channel) => channel.length !== channels[0]!.length)
			|| Number(rendered.sampleRate) !== dependencies.getProject().sampleRate) {
			throw new Error(dependencies.copy.effectInvalidAudio);
		}
		if (outputChannelCount === 2) {
			if (channels.length !== 2) throw new Error(dependencies.copy.effectInvalidAudio);
			return rendered;
		}
		if (channels.length === 1) return rendered;
		const mono = new Float32Array(channels[0].length);
		for (let frame = 0; frame < mono.length; frame += 1) {
			mono[frame] = (channels[0][frame]! + channels[1]![frame]!) * Math.SQRT1_2;
		}
		const context = await dependencies.getAudioContext();
		assertOwned(ownership);
		const output = await dependencies.createBufferFromChannels([mono], rendered.sampleRate, context);
		assertOwned(ownership);
		return output;
	}

	async function persistStreamedMixSource(
		project: MutableControllerProject,
		name: string,
		plan: Readonly<{
			startFrame: number;
			endFrame: number;
			tailFrames: number;
			preRollFrames: number;
			outputFrames: number;
		}>,
		ownership: MixOwnership,
	): Promise<DerivedSourceRecord> {
		const sampleRate = project.sampleRate;
		const sourceId = dependencies.createId('mixed-source');
		const renderEngine = dependencies.createRenderEngine();
		let writer: StreamingSourceWriter | null = null;
		let committed = false;
		try {
			await dependencies.prepareCommittedTimePitchCaches(project);
			assertOwned(ownership);
			const rawWriter = await dependencies.store.beginSourceWrite(sourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate,
				channelCount: 2,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			assertOwned(ownership);
			writer = dependencies.createStreamingWriter(rawWriter);
			renderEngine.loadProject(project, dependencies.sourceBuffers);
			const result = await renderEngine.renderMixToSink({
				sink: writer,
				startFrame: plan.startFrame,
				endFrame: plan.endFrame,
				includeTail: plan.tailFrames ? plan.tailFrames / sampleRate : false,
				includeMaster: false,
				includeTrackPan: true,
				respectMuteSolo: false,
				preRollFrames: plan.preRollFrames,
				outputFrames: plan.outputFrames,
				sampleRate,
			});
			assertOwned(ownership);
			if (Number(result.sampleRate) !== sampleRate
				|| Number(result.channelCount) !== 2
				|| Number(result.frameCount) !== plan.outputFrames
				|| writer.channelCount !== 2
				|| writer.framesWritten !== plan.outputFrames) {
				throw new Error(dependencies.copy.effectInvalidAudio);
			}
			const metadata = await writer.commit({
				sampleRate,
				channelCount: 2,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			committed = true;
			assertOwned(ownership);
			const source: ControllerSource = Object.freeze({
				schemaVersion: 2,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: plan.outputFrames,
				channelCount: 2,
				sampleRate,
				originalSampleRate: sampleRate,
				sampleFormat: 'float32',
				chunkFrames: dependencies.sourceChunkFrames,
				opaqueExtensions: {},
			});
			await dependencies.activateStoredSource(source, metadata);
			assertOwned(ownership);
			return Object.freeze({ source, buffer: null, channels: null });
		} catch (error) {
			if (committed) {
				await dependencies.derivedSources.rollbackDerivedSources([{
					source: streamedSourcePlaceholder(sourceId, name, plan.outputFrames, sampleRate),
				}]);
			} else {
				await Promise.resolve(writer?.abort()).catch(() => undefined);
			}
			throw error;
		} finally {
			await Promise.resolve(renderEngine.dispose()).catch(() => undefined);
		}
	}

	function assertOwned(ownership: MixOwnership): void {
		ownership.task.assertCurrent();
		dependencies.assertProject(ownership.project);
	}

	function isOwned(ownership: MixOwnership): boolean {
		return taskIsCurrent(ownership.task) && projectIsCurrent(ownership.project);
	}

	function taskIsCurrent(task: EditorTaskScope): boolean {
		try {
			task.assertCurrent();
			return true;
		} catch {
			return false;
		}
	}

	function projectIsCurrent(token: EditorProjectToken): boolean {
		try {
			dependencies.assertProject(token);
			return true;
		} catch {
			return false;
		}
	}
}

function bufferChannels(buffer: AudioBufferLike): Float32Array[] {
	return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

function streamedSourcePlaceholder(
	id: string,
	name: string,
	frameCount: number,
	sampleRate: number,
): ControllerSource {
	return {
		id,
		storageKey: id,
		name,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 2,
		sampleRate,
		originalSampleRate: sampleRate,
	};
}
