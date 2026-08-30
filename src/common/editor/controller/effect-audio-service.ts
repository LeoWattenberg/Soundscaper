/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectToken, EditorTaskScope } from './lifecycle.ts';
import { hasCoreEditingProjectAuthority, hasProductionMixerProjectAuthority } from '../project-schema-version.ts';
import type {
	EffectSelection,
	EffectSelectionFrequencyRange,
	EffectTarget,
} from './effect-selection-service.ts';
import type { PersistEffectResultOptions, SelectionEffectResult } from './effect-result-service.ts';
import { createIsolatedTrackRenderProjectV21 } from './isolated-track-render-project-v21.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import {
	createDeferredLocalAssistancePreparation,
} from './deferred-local-assistance-runtime.ts';
import { loadDeferredSpectralEditAdmission } from './deferred-spectral-edit-admission.ts';
import {
	copyMasterNoiseProfileChannels,
	masterNoiseProfileChannelCount,
} from './master-noise-profile-channels.ts';

const NOISE_PROFILE_TASK = 'selection-effect-noise-profile';
const SPECTRAL_EFFECT_TASK = 'selection-effect-spectral';

export interface EffectAudioEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly enabled?: boolean;
	readonly context?: Readonly<Record<string, unknown>> | null;
}

export interface EffectAudioTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
	readonly effects?: readonly EffectAudioEffect[];
	readonly gain?: number;
	readonly pan?: number;
	readonly mute?: boolean;
	readonly solo?: boolean;
	readonly envelope?: readonly unknown[];
	readonly spectrogram?: Readonly<{ readonly windowSize?: number }>;
}

export interface EffectAudioClip extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind?: 'audio' | 'video';
	readonly sourceId: string;
	readonly title: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

export interface EffectAudioProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly masterChannels: number;
	readonly tracks: readonly EffectAudioTrack[];
	readonly clips: readonly EffectAudioClip[];
	readonly selection?: EffectSelection | null;
	readonly master: Readonly<{ readonly gain?: number; readonly effects: readonly EffectAudioEffect[] }>;
	readonly mixer: Readonly<Record<string, unknown>>;
}

interface MutableEffectAudioTrack extends Record<string, unknown> {
	id: string;
	name: string;
	type: 'audio' | 'video' | 'label';
	clipIds: string[];
	effects: EffectAudioEffect[];
	gain: number;
	pan: number;
	mute: boolean;
	solo: boolean;
	envelope?: unknown[];
}

interface MutableEffectAudioProject extends Record<string, unknown> {
	id: string;
	schemaVersion: number;
	sampleRate: number;
	masterChannels: number;
	tracks: MutableEffectAudioTrack[];
	clips: EffectAudioClip[];
	selection: EffectSelection | null;
	master: { gain?: number; effects: EffectAudioEffect[] };
	mixer: Record<string, unknown>;
}

export interface EffectAudioState {
	selectedTrackId: string | null;
	selectedClipId: string | null;
	audacityEffectProcessing: boolean;
	audacityNoiseProfile: unknown;
}

interface EffectAudioBuffer {
	readonly channels?: readonly Float32Array[];
	readonly [property: string]: unknown;
}

interface EffectAudioRenderEngine {
	loadProject(project: EffectAudioProject, sourceBuffers: unknown): void;
	renderTrack(trackId: string, options: Readonly<Record<string, unknown>>): Promise<EffectAudioBuffer>;
	renderMix(options: Readonly<Record<string, unknown>>): Promise<EffectAudioBuffer>;
	dispose(): Promise<void> | void;
}

interface EffectAudioCopy {
	readonly audacityApplied: string;
	readonly audacityProcessing: string;
	readonly audacityProfileProcessing: string;
	readonly audacitySelectionHint: string;
	readonly audioTrackNotFound: string;
	readonly effectProcessingFailed: string;
	readonly noiseProfileMinimumSamples: string;
	readonly noiseProfileReady: string;
	readonly rackEffectNotFound: string;
	readonly spectralAmplify: string;
	readonly spectralApplied: string;
	readonly spectralDelete: string;
	readonly spectralGainInvalid: string;
	readonly spectralProcessing: string;
	readonly spectralSelectionRequired: string;
	readonly v2Required: string;
}

interface NoiseProfileWorkerResult {
	readonly profile: unknown;
}

export interface EffectAudioServiceRuntime {
	readonly lifetime: Readonly<{ startTask(name: string): EditorTaskScope }>;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly state: EffectAudioState;
	readonly copy: EffectAudioCopy;
	readonly memoryLimitBytes: number;
	readonly getProject: () => EffectAudioProject;
	readonly activeSelection: () => EffectSelection | null;
	readonly audacityEffectTarget: (trackId?: string | null) => EffectTarget | null;
	readonly audacityEffectTargets: (options?: Readonly<{ includeSilentTracks?: boolean }>) => EffectTarget[];
	readonly audacityEffectSelectionDetails: (
		selection: EffectSelection | null,
		targets: readonly EffectTarget[],
	) => Readonly<{
		trackIds: readonly string[];
		clipIds: readonly string[];
		frequencyRange: EffectSelectionFrequencyRange | null;
	}>;
	readonly editingBlocked: () => boolean;
	readonly projectSampleRate: () => number;
	readonly currentAudacityEffectParams: (type: string) => Readonly<Record<string, unknown>>;
	readonly estimateAudacityEffectPeakBytes: (
		type: string,
		frames: number,
		params: Readonly<Record<string, unknown>>,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	) => number;
	readonly audacityEffectMemoryError: () => Error;
	readonly preflightStorage: (bytes: number, kind: 'effect') => Promise<unknown>;
	readonly createId: (prefix: string) => string;
	readonly cloneProject: (project: EffectAudioProject) => EffectAudioProject;
	readonly audacitySelectionChannelCount: (
		project: EffectAudioProject,
		trackId: string,
		startFrame: number,
		endFrame: number,
	) => number;
	readonly renderSnapshot: (
		project: EffectAudioProject,
		options: Readonly<Record<string, unknown>>,
		sourceMap?: unknown,
		signal?: AbortSignal | null,
	) => Promise<EffectAudioBuffer>;
	readonly prepareCommittedTimePitchCaches: (project: EffectAudioProject) => Promise<unknown>;
	readonly createRenderEngine: () => EffectAudioRenderEngine;
	readonly sourceBuffers: unknown;
	readonly audioBufferChannels: (buffer: EffectAudioBuffer) => readonly Float32Array[];
	readonly matchAudacitySelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
	readonly runSelectionEffectWorker: (request: Readonly<{
		operation: 'capture-noise-profile';
		channels: Float32Array[];
		sampleRate: number;
		params: Readonly<Record<string, unknown>>;
	}>) => Promise<NoiseProfileWorkerResult>;
	readonly runSpectralEditWorker: (
		channels: Float32Array[],
		options: Readonly<{
			sampleRate: number;
			startFrame: number;
			endFrame: number;
			minimumFrequency: number;
			maximumFrequency: number;
			windowSize: number;
			gainDb: number;
		}>,
	) => Promise<Float32Array[]>;
	readonly serializeNoiseProfile: (profile: unknown) => unknown;
	readonly assistanceStore?: unknown;
	readonly assistanceVideoStore?: unknown;
	readonly assistanceDerivativeRepository?: import(
		'../storage/deferred-assistance-derivative-repository.ts'
	).AssistanceDerivativeRepositoryPort;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
	readonly persistAudacityEffectResults: (
		results: readonly SelectionEffectResult[],
		type: null,
		options: PersistEffectResultOptions,
	) => Promise<unknown>;
	readonly setStatus: (message: string, status?: string) => void;
	readonly publishDocumentSnapshot: () => void;
}

export function createEffectAudioService(runtime: EffectAudioServiceRuntime) {
	async function renderDryTrackRange(
		trackId: string,
		startFrame: number,
		endFrame: number,
		requestedChannelCount: number | null = null,
		requestedClipIds: readonly string[] | null = null,
		signal: AbortSignal | null = null,
		processing: 'dry' | 'authored' = 'dry',
	): Promise<Float32Array[]> {
		signal?.throwIfAborted();
		const project = runtime.getProject();
		const token = runtime.captureProject();
		const track = findTrack(project, trackId);
		if (!track) throw new Error(runtime.copy.audioTrackNotFound);
		const channelCount = requestedChannelCount
			?? (runtime.audacitySelectionChannelCount(project, trackId, startFrame, endFrame) || 1);
		// Flatten folder state before narrowing to one track: the snapshot keeps the
		// authored folders and sequence nodes, so a hierarchy that still names the
		// tracks this render drops is one the engine refuses to load.
		const mediaProject = projectTrackFolderMediaStateV12(project);
		let snapshot = inheritTrackFolderMediaStateProjectionV12(
			mediaProject,
			runtime.cloneProject(mediaProject),
		) as unknown as MutableEffectAudioProject;
		const clipIdSet = requestedClipIds?.length ? new Set(requestedClipIds) : null;
		if (hasProductionMixerProjectAuthority(snapshot)) {
			snapshot = createIsolatedTrackRenderProjectV21(snapshot as never, {
				trackId, effects: [], clipIds: requestedClipIds,
				preserveTrackProcessing: processing === 'authored',
			}) as unknown as MutableEffectAudioProject;
		} else {
			snapshot.tracks = snapshot.tracks
				.filter((candidate) => candidate.id === trackId)
				.map((candidate) => ({
					...candidate,
					...(clipIdSet ? { clipIds: candidate.clipIds.filter((clipId) => clipIdSet.has(clipId)) } : {}),
					...(processing === 'authored' ? {} : {
						gain: 1, pan: 0, mute: false, solo: false, effects: [], envelope: [],
					}),
				}));
			snapshot.master = { gain: 1, effects: [] };
			snapshot.mixer = { groups: [], sends: [], routes: {} };
		}
		const rendered = await runtime.renderSnapshot(snapshot, {
			startFrame,
			endFrame,
			trackId,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: endFrame - startFrame,
		}, runtime.sourceBuffers, signal);
		signal?.throwIfAborted();
		runtime.assertProject(token);
		return runtime.matchAudacitySelectionChannels(runtime.audioBufferChannels(rendered), channelCount);
	}

	async function renderRackPrefixRange(
		effect: EffectAudioEffect,
		scope: 'master' | 'track',
		startFrame: number,
		endFrame: number,
		channelCount: number,
		requestedTrackId: string | null = runtime.state.selectedTrackId,
	): Promise<Float32Array[]> {
		const project = runtime.getProject();
		const token = runtime.captureProject();
		let snapshot = runtime.cloneProject(project) as unknown as MutableEffectAudioProject;
		const trackId = requestedTrackId;
		if (scope === 'track') {
			const track = findMutableTrack(snapshot, trackId);
			if (!track) throw new Error(runtime.copy.audioTrackNotFound);
			const effectIndex = track.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error(runtime.copy.rackEffectNotFound);
			const prefix = track.effects.slice(0, effectIndex);
			if (hasProductionMixerProjectAuthority(snapshot)) {
				snapshot = createIsolatedTrackRenderProjectV21(snapshot as never, {
					trackId: requireTrackId(trackId), effects: prefix,
				}) as unknown as MutableEffectAudioProject;
			} else {
				track.effects = prefix;
				track.gain = 1;
				track.pan = 0;
				track.mute = false;
				track.solo = false;
				track.envelope = [];
				snapshot.mixer = { ...snapshot.mixer, groups: [], sends: [], routes: {} };
			}
		} else {
			const effectIndex = snapshot.master.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error(runtime.copy.rackEffectNotFound);
			snapshot.master.effects = snapshot.master.effects.slice(0, effectIndex);
			snapshot.master.gain = 1;
		}
		await runtime.prepareCommittedTimePitchCaches(snapshot);
		runtime.assertProject(token);
		const engine = runtime.createRenderEngine();
		let channels: Float32Array[];
		try {
			engine.loadProject(snapshot, runtime.sourceBuffers);
			const rendered = scope === 'track'
				? await engine.renderTrack(requireTrackId(trackId), { startFrame, endFrame, includeTrackPan: false })
				: await engine.renderMix({ startFrame, endFrame, includeMaster: true, respectMuteSolo: true });
			runtime.assertProject(token);
			const renderedChannels = runtime.audioBufferChannels(rendered);
			channels = scope === 'master'
				? copyMasterNoiseProfileChannels(renderedChannels, channelCount)
				: runtime.matchAudacitySelectionChannels(renderedChannels, channelCount);
		} finally {
			await engine.dispose();
		}
		runtime.assertProject(token);
		return channels;
	}

	async function captureSelectedNoiseProfile(): Promise<void> {
		if (runtime.editingBlocked()) return;
		const target = runtime.audacityEffectTarget();
		if (!target) throw new Error(runtime.copy.audacitySelectionHint);
		const sampleRate = runtime.projectSampleRate();
		const params = runtime.currentAudacityEffectParams('audacity-noise-reduction');
		const estimatedPeakBytes = runtime.estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction', target.durationFrames, params,
			{ channelCount: target.channelCount, sampleRate },
		);
		if (estimatedPeakBytes > runtime.memoryLimitBytes) throw runtime.audacityEffectMemoryError();
		const ownership = beginOwnership(runtime, NOISE_PROFILE_TASK);
		beginProcessing(runtime, runtime.copy.audacityProfileProcessing);
		try {
			const channels = await renderDryTrackRange(
				target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds ?? null,
			);
			assertOwnership(runtime, ownership);
			const result = await runtime.runSelectionEffectWorker({
				operation: 'capture-noise-profile', channels, sampleRate, params,
			});
			assertOwnership(runtime, ownership);
			runtime.state.audacityNoiseProfile = result.profile;
			runtime.setStatus(runtime.copy.noiseProfileReady, 'success');
		} finally {
			finishProcessing(runtime, ownership);
		}
	}

	async function captureRackNoiseProfile(
		effect: EffectAudioEffect,
		scope: 'master' | 'track',
		requestedTrackId: string | null = runtime.state.selectedTrackId,
	): Promise<void> {
		if (runtime.editingBlocked()) return;
		const project = runtime.getProject();
		const selectionTarget = runtime.audacityEffectTarget(requestedTrackId);
		const selection = runtime.activeSelection();
		const selectedClip = findClip(project, runtime.state.selectedClipId);
		const startFrame = selection?.startFrame ?? selectedClip?.timelineStartFrame;
		const endFrame = selection?.endFrame
			?? (selectedClip ? selectedClip.timelineStartFrame + selectedClip.durationFrames : null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)
			|| startFrame == null || endFrame == null || endFrame <= startFrame) {
			throw new Error(runtime.copy.audacitySelectionHint);
		}
		const durationFrames = endFrame - startFrame;
		const sampleRate = runtime.projectSampleRate();
		if (durationFrames < 2_048) throw new Error(runtime.copy.noiseProfileMinimumSamples);
		if (scope === 'track' && (!selectionTarget || selectionTarget.track.id !== requestedTrackId)) {
			throw new Error(runtime.copy.audacitySelectionHint);
		}
		const channelCount = scope === 'track'
			? selectionTarget!.channelCount
			: masterNoiseProfileChannelCount(project.masterChannels);
		const estimatedPeakBytes = runtime.estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction', durationFrames, effect.params, { channelCount, sampleRate },
		);
		if (estimatedPeakBytes > runtime.memoryLimitBytes) throw runtime.audacityEffectMemoryError();
		const ownership = beginOwnership(runtime, NOISE_PROFILE_TASK);
		beginProcessing(runtime, runtime.copy.audacityProfileProcessing);
		try {
			const channels = await renderRackPrefixRange(
				effect, scope, startFrame, endFrame, channelCount, requestedTrackId,
			);
			assertOwnership(runtime, ownership);
			const result = await runtime.runSelectionEffectWorker({
				operation: 'capture-noise-profile', channels, sampleRate, params: effect.params,
			});
			assertOwnership(runtime, ownership);
			runtime.state.audacityNoiseProfile = result.profile;
			const target = scope === 'master'
				? { scope: 'master' as const }
				: { scope: 'track' as const, trackId: requireTrackId(requestedTrackId) };
			runtime.commit({
				type: 'effect/update',
				...target,
				effectId: effect.id,
				changes: {
					enabled: effect.context?.noiseProfile ? effect.enabled : true,
					context: { noiseProfile: runtime.serializeNoiseProfile(result.profile) },
				},
			});
			runtime.setStatus(runtime.copy.noiseProfileReady, 'success');
		} finally {
			finishProcessing(runtime, ownership);
		}
	}

	async function applySpectralSelection(requestedGainDb: unknown): Promise<true | null> {
		if (runtime.editingBlocked()) return null;
		const {
			inspectSpectralEditChannels,
			MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
			planSpectralEditWorkflowAdmission,
		} = await loadDeferredSpectralEditAdmission();
		const project = runtime.getProject();
		if (!hasCoreEditingProjectAuthority(project)) throw new Error(runtime.copy.v2Required);
		const selection = runtime.activeSelection();
		const frequencyRange = selection?.frequencyRange;
		const targets = runtime.audacityEffectTargets();
		if (!targets.length || !frequencyRange) {
			throw new Error(runtime.copy.spectralSelectionRequired || runtime.copy.audacitySelectionHint);
		}
		const gainDb = Number(requestedGainDb);
		if (gainDb !== -Infinity && (!Number.isFinite(gainDb) || gainDb > 120 || gainDb < -120)) {
			throw new RangeError(runtime.copy.spectralGainInvalid);
		}
		const admission = planSpectralEditWorkflowAdmission({
			targets: targets.map((target) => ({
				channelCount: target.channelCount,
				frameCount: target.durationFrames,
				selectionFrameCount: target.durationFrames,
				windowSize: Number(target.track.spectrogram?.windowSize) || 2_048,
			})),
			maximumUsefulBinaryBytes: Math.min(
				runtime.memoryLimitBytes,
				MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
			),
		});
		const ownership = beginOwnership(runtime, SPECTRAL_EFFECT_TASK);
		let processing = false;
		try {
			await runtime.preflightStorage(admission.finalRetainedCompletedOutputBytes, 'effect');
			assertOwnership(runtime, ownership);
			processing = true;
			beginProcessing(runtime, runtime.copy.spectralProcessing || runtime.copy.audacityProcessing);
			const results: Array<{ target: EffectTarget; channels: Float32Array[] }> = [];
			for (const [targetIndex, target] of targets.entries()) {
				const phase = admission.phases[targetIndex]!;
				const channels = await renderDryTrackRange(
					target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds ?? null,
				);
				assertOwnership(runtime, ownership);
				inspectSpectralEditChannels(channels, {
					label: 'Spectral edit dry-render input',
					expectedChannelCount: phase.channelCount,
					expectedFrameCount: phase.frameCount,
				});
				const processed = await runtime.runSpectralEditWorker(channels, {
					sampleRate: runtime.projectSampleRate(),
					startFrame: 0,
					endFrame: target.durationFrames,
					minimumFrequency: frequencyRange.minimumFrequency,
					maximumFrequency: frequencyRange.maximumFrequency,
					windowSize: phase.windowSize,
					gainDb,
				});
				assertOwnership(runtime, ownership);
				inspectSpectralEditChannels(processed, {
					label: 'Spectral edit result',
					expectedChannelCount: phase.channelCount,
					expectedFrameCount: phase.frameCount,
				});
				results.push({ target, channels: processed });
			}
			await runtime.persistAudacityEffectResults(results, null, {
				assertCurrent: () => assertOwnership(runtime, ownership),
				effectName: gainDb === -Infinity ? runtime.copy.spectralDelete : runtime.copy.spectralAmplify,
				selectionDetails: runtime.audacityEffectSelectionDetails(selection, targets),
			});
			assertOwnership(runtime, ownership);
			runtime.setStatus(runtime.copy.spectralApplied || runtime.copy.audacityApplied, 'success');
			return true;
		} finally {
			if (processing) finishProcessing(runtime, ownership);
			else ownership.task.finish();
		}
	}

	const selectedMediaPreparation = createDeferredLocalAssistancePreparation({
		getProject: runtime.getProject,
		getSelectedClipId: () => runtime.state.selectedClipId,
		captureProject: runtime.captureProject,
		assertProject: (token: unknown) => runtime.assertProject(token as EditorProjectToken),
		renderDryTrackRange,
		createId: runtime.createId,
		preflightStorage: runtime.preflightStorage,
		...(runtime.assistanceStore ? { assistanceStore: runtime.assistanceStore } : {}),
		...(runtime.assistanceVideoStore ? { assistanceVideoStore: runtime.assistanceVideoStore } : {}),
		...(runtime.assistanceDerivativeRepository
			? { assistanceDerivativeRepository: runtime.assistanceDerivativeRepository } : {}),
		commit: runtime.commit,
	});

	return Object.freeze({
		applySpectralSelection,
		captureRackNoiseProfile,
		captureSelectedNoiseProfile,
		selectedMediaPreparation,
		renderDryTrackRange,
		renderRackPrefixRange,
	});
}

interface ProcessingOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

function beginOwnership(runtime: EffectAudioServiceRuntime, taskName: string): ProcessingOwnership {
	return { task: runtime.lifetime.startTask(taskName), project: runtime.captureProject() };
}

function assertOwnership(runtime: EffectAudioServiceRuntime, ownership: ProcessingOwnership): void {
	ownership.task.assertCurrent();
	runtime.assertProject(ownership.project);
}

function beginProcessing(runtime: EffectAudioServiceRuntime, status: string): void {
	runtime.state.audacityEffectProcessing = true;
	runtime.setStatus(status);
	runtime.publishDocumentSnapshot();
}

function finishProcessing(runtime: EffectAudioServiceRuntime, ownership: ProcessingOwnership): void {
	const taskCurrent = taskIsCurrent(ownership.task);
	if (taskCurrent) runtime.state.audacityEffectProcessing = false;
	if (taskCurrent && projectIsCurrent(runtime, ownership.project)) runtime.publishDocumentSnapshot();
	ownership.task.finish();
}

function taskIsCurrent(task: EditorTaskScope): boolean {
	try { task.assertCurrent(); return true; } catch { return false; }
}

function projectIsCurrent(runtime: EffectAudioServiceRuntime, token: EditorProjectToken): boolean {
	try { runtime.assertProject(token); return true; } catch { return false; }
}

function findTrack(project: EffectAudioProject, trackId: string | null | undefined): EffectAudioTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findMutableTrack(
	project: MutableEffectAudioProject,
	trackId: string | null | undefined,
): MutableEffectAudioTrack | null {
	return project.tracks.find((track) => track.id === trackId) ?? null;
}

function findClip(project: EffectAudioProject, clipId: string | null): EffectAudioClip | null {
	return project.clips.find((clip) => clip.id === clipId) ?? null;
}

function requireTrackId(trackId: string | null): string {
	if (!trackId) throw new TypeError('A track id is required.');
	return trackId;
}
