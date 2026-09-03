/* SPDX-License-Identifier: AGPL-3.0-only */

import { findStereoLimitedMultichannelRenderEffects } from '../adm-render-safety.ts';
import {
	hasCoreEditingProjectAuthority,
	isSoundscaperProductionProject,
} from '../project-schema-version.ts';

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
	mixRenderTailFrames,
	selectAudioTracksForMix,
} from './mix-render-model.ts';
import {
	prepareMixRenderOperationCommit,
	type MixRenderRenderedOutput,
	type MixRenderResult,
} from './mix-render-commit.ts';
import { createNormalizingMixRenderPacketSink } from './mix-render-channel-normalizer.ts';
import { assertMixRenderPreflight } from './mix-render-operation-model.ts';
import {
	normalizeMixRenderOptions,
	type MixRenderOptions,
} from './mix-render-options.ts';
import {
	nonemptyAudioTargets,
	predictIndividualMixRenderOutputChannelCount,
	predictMixRenderOutputChannelCount,
} from './mix-render-output-layout.ts';
import {
	preserveProductionMixRenderRouting,
	type MixRenderCommandPreview,
} from './mix-render-routing.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type {
	ControllerEffect,
	ControllerProject,
	ControllerSource,
	ControllerTrack,
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
	previewCommand?: MixRenderCommandPreview;
}

export interface MixRenderService {
	mixAndRenderTracks(options?: MixRenderOptions): Promise<Readonly<MixRenderResult> | null>;
}

interface MixOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

interface MixRenderJob {
	readonly targetTracks: readonly ControllerTrack[];
	readonly renderProject: MutableControllerProject;
	readonly plan: NonNullable<ReturnType<typeof createMixRenderPlan>>;
	readonly name: string;
	readonly sourceName: string;
}

export function createMixRenderService(
	dependencies: MixRenderServiceDependencies,
): Readonly<MixRenderService> {
	return Object.freeze({ mixAndRenderTracks });

	async function mixAndRenderTracks(
		requestedOptions?: MixRenderOptions,
	): Promise<Readonly<MixRenderResult> | null> {
		dependencies.lifetime.assertActive();
		const options = normalizeMixRenderOptions(requestedOptions);
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		if (!hasCoreEditingProjectAuthority(project)) throw new Error(dependencies.copy.v2Required);
		const targetTracks = nonemptyAudioTargets(project, selectAudioTracksForMix(
			project,
			dependencies.getSelectedTrackId(),
			dependencies.getSelectedClipId(),
		));
		if (!targetTracks.length) throw new Error(dependencies.copy.mixRenderRequiresAudio
			|| dependencies.copy.audacitySelectionHint || dependencies.copy.audioTrackRequired);
		assertMixRenderPreflight(project, targetTracks, options);
		const jobs = prepareJobs(project, targetTracks, options);
		const outputBytes = jobs.reduce((total, job) => total + job.plan.outputBytes, 0);
		if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) {
			throw new RangeError('Mix and Render storage size exceeds the supported range.');
		}
		const ownership = {
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(MIX_RENDER_TASK),
		};
		dependencies.setProcessing(true);
		dependencies.setStatus(dependencies.copy.rendering);
		dependencies.publish();
		const renderedSources: DerivedSourceRecord[] = [];
		let published = false;
		try {
			await dependencies.preflightStorage(outputBytes, 'effect');
			assertOwned(ownership);
			for (const job of jobs) {
				let renderedSource: DerivedSourceRecord;
				if (job.plan.streamToStorage) {
					renderedSource = await persistStreamedMixSource(
						job.renderProject, job.sourceName, job.plan, ownership,
					);
				} else {
					const rendered = await dependencies.renderSnapshot(job.renderProject, {
						startFrame: job.plan.startFrame,
						endFrame: job.plan.endFrame,
						includeTail: job.plan.tailFrames
							? job.plan.tailFrames / project.sampleRate : false,
						includeMaster: false,
						includeTrackPan: true,
						respectMuteSolo: false,
						preRollFrames: job.plan.preRollFrames,
					});
					assertOwned(ownership);
					const normalized = await normalizeMixOutput(
						rendered, job.plan.outputChannelCount, job.plan.outputFrames, ownership,
					);
					renderedSource = await dependencies.derivedSources.persistRenderedMixSource(
						normalized, job.sourceName,
					);
				}
				renderedSources.push(renderedSource);
				assertOwned(ownership);
			}
			const outputs: MixRenderRenderedOutput[] = jobs.map((job, index) => ({
				targetTracks: job.targetTracks,
				source: renderedSources[index]!.source,
				startFrame: job.plan.startFrame,
				name: job.name,
			}));
			let prepared = prepareMixRenderOperationCommit(project, outputs, options, {
				createId: dependencies.createId,
			});
			if (prepared.routingCopies.length || prepared.directRoutingTrackIds.length) {
				if (!dependencies.previewCommand) {
					throw new Error('Production Mix and Render routing preview is unavailable.');
				}
				prepared = preserveProductionMixRenderRouting(
					project, prepared, dependencies.previewCommand, dependencies.createId,
				);
			}
			assertOwned(ownership);
			dependencies.previewCommand?.(project, prepared.command);
			const primary = prepared.results[0]!;
			dependencies.commit(prepared.command, {
				selectTrackId: primary.trackId,
				selectClipId: primary.clipId,
			});
			published = true;
			dependencies.setStatus(dependencies.copy.done, 'success');
			return primary;
		} catch (error) {
			let failure = error;
			if (renderedSources.length && !published) {
				failure = await rollbackStagedSources(renderedSources, error);
			}
			if (isOwned(ownership)) dependencies.handleError(failure);
			throw failure;
		} finally {
			if (taskIsCurrent(ownership.task)) {
				dependencies.setProcessing(false);
				if (projectIsCurrent(ownership.project)) dependencies.publish();
				ownership.task.finish();
			}
		}
	}

	function prepareJobs(
		project: ControllerProject,
		targetTracks: readonly ControllerTrack[],
		options: ReturnType<typeof normalizeMixRenderOptions>,
	): MixRenderJob[] {
		const groups = options.mixDown ? [targetTracks] : targetTracks.map((track) => [track]);
		return groups.map((jobTracks) => {
			const renderProject = createMixRenderSnapshot(project, jobTracks, {
				mixDown: options.mixDown,
				renderEffects: options.renderEffects,
			});
			assertMixRenderEffectChannelSafety(renderProject);
			const tailFrames = mixRenderTailFrames(
				jobTracks,
				renderProject,
				project.sampleRate,
				dependencies.rackTailFrames,
				{ includeBuses: options.mixDown, renderEffects: options.renderEffects },
			);
			const outputChannelCount = options.mixDown
				? predictMixRenderOutputChannelCount(project, jobTracks, options.renderEffects)
				: predictIndividualMixRenderOutputChannelCount(project, jobTracks[0]!, options.renderEffects);
			if (outputChannelCount === null) throw new Error(dependencies.copy.mixRenderRequiresAudio
				|| dependencies.copy.audacitySelectionHint || dependencies.copy.audioTrackRequired);
			const plan = createMixRenderPlan(
				project, jobTracks, tailFrames, dependencies.memoryLimitBytes, outputChannelCount,
			);
			if (!plan) throw new Error(dependencies.copy.mixRenderRequiresAudio
				|| dependencies.copy.audacitySelectionHint || dependencies.copy.audioTrackRequired);
			const name = options.mixDown
				? options.replaceOriginals && targetTracks.length === 1
					? jobTracks[0]!.name
					: dependencies.copy.mixedTrack || 'Mix'
				: options.replaceOriginals
					? jobTracks[0]!.name
					: `${jobTracks[0]!.name} — Rendered`;
			return Object.freeze({
				targetTracks: jobTracks,
				renderProject,
				plan,
				name,
				sourceName: `${name} — ${dependencies.copy.mixRender
					|| dependencies.copy.mixdownTo || 'Mix and render'}.wav`,
			});
		});
	}

	async function normalizeMixOutput(
		rendered: AudioBufferLike,
		outputChannelCount: number,
		outputFrames: number,
		ownership: MixOwnership,
	): Promise<AudioBufferLike> {
		const channels = bufferChannels(rendered);
		if (!channels.length || channels.length > 32 || !channels[0]?.length
			|| channels.some((channel) => channel.length !== channels[0]!.length)
			|| Number(rendered.length) !== outputFrames
			|| Number(rendered.sampleRate) !== dependencies.getProject().sampleRate) {
			throw new Error(dependencies.copy.effectInvalidAudio);
		}
		if (channels.length === outputChannelCount) return rendered;
		if (outputChannelCount !== 1 || channels.length !== 2) {
			throw new Error(dependencies.copy.effectInvalidAudio);
		}
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
			outputChannelCount: number;
		}>,
		ownership: MixOwnership,
	): Promise<DerivedSourceRecord> {
		const sampleRate = project.sampleRate;
		const sourceId = dependencies.createId('mixed-source');
		const renderEngine = dependencies.createRenderEngine();
		let rawWriter: SourceWriter | null = null;
		let writer: StreamingSourceWriter | null = null;
		let committed = false;
		try {
			await dependencies.prepareCommittedTimePitchCaches(project);
			assertOwned(ownership);
			rawWriter = await dependencies.store.beginSourceWrite(sourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate,
				channelCount: plan.outputChannelCount,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			assertOwned(ownership);
			writer = dependencies.createStreamingWriter(rawWriter);
			rawWriter = null;
			const sink = createNormalizingMixRenderPacketSink(
				writer,
				plan.outputChannelCount,
				() => new Error(dependencies.copy.effectInvalidAudio),
			);
			renderEngine.loadProject(project, dependencies.sourceBuffers);
			const result = await renderEngine.renderMixToSink({
				sink,
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
				|| Number(result.channelCount) !== sink.inputChannelCount
				|| Number(result.frameCount) !== plan.outputFrames
				|| writer.channelCount !== plan.outputChannelCount
				|| writer.framesWritten !== plan.outputFrames) {
				throw new Error(dependencies.copy.effectInvalidAudio);
			}
			const metadata = await writer.commit({
				sampleRate,
				channelCount: plan.outputChannelCount,
				chunkFrames: dependencies.sourceChunkFrames,
			});
			committed = true;
			assertOwned(ownership);
			const source: ControllerSource = Object.freeze({
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: plan.outputFrames,
				channelCount: plan.outputChannelCount,
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
					source: streamedSourcePlaceholder(
						sourceId,
						name,
						plan.outputFrames,
						plan.outputChannelCount,
						sampleRate,
					),
				}]);
			} else {
				await Promise.resolve((writer ?? rawWriter)?.abort(error)).catch(() => undefined);
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

	async function rollbackStagedSources(
		records: readonly DerivedSourceRecord[],
		primaryError: unknown,
	): Promise<unknown> {
		const cleanupErrors: unknown[] = [];
		for (const record of [...records].reverse()) {
			try {
				await dependencies.derivedSources.rollbackDerivedSources([record]);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		if (!cleanupErrors.length) return primaryError;
		return new AggregateError(
			[primaryError, ...cleanupErrors],
			'Mix and Render failed and staged source cleanup was incomplete.',
			{ cause: primaryError },
		);
	}
}

function assertMixRenderEffectChannelSafety(project: ControllerProject): void {
	if (!isSoundscaperProductionProject(project)) return;
	const issues = findStereoLimitedMultichannelRenderEffects(
		project as never,
		Number(project.masterChannels),
		{ includeMaster: false },
	);
	if (!issues.length) return;
	throw new Error(`Multichannel Mix and Render cannot use effects that change channel width: ${issues
		.map(({ effectType, scope, targetId, channelCount }) => (
			`${effectType} on ${scope}${targetId ? ` ${targetId}` : ''} (${String(channelCount)} channels)`
		))
		.join(', ')}.`);
}

function bufferChannels(buffer: AudioBufferLike): Float32Array[] {
	return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

function streamedSourcePlaceholder(
	id: string,
	name: string,
	frameCount: number,
	channelCount: number,
	sampleRate: number,
): ControllerSource {
	return {
		id,
		storageKey: id,
		name,
		mimeType: 'audio/wav',
		frameCount,
		channelCount,
		sampleRate,
		originalSampleRate: sampleRate,
	};
}
