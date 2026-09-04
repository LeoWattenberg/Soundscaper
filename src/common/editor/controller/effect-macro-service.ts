/* SPDX-License-Identifier: AGPL-3.0-only */

import { isSoundscaperProductionProject } from '../project-schema-version.ts';
import {
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from '../selection-effects.js';
import {
	isRealtimeEffectMacroStepType,
	normalizeEffectMacroStep,
} from '../effect-macro-steps.ts';
import { isMacroCommandStep } from '../macro-command-steps.ts';
import {
	createEffectMacroChainRunner,
	planEffectMacroChain,
	type EffectMacroChainStep,
} from './effect-macro-chain.ts';
import type {
	EditorControllerLifetime,
	EditorProjectGeneration,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import type { EffectTarget } from './effect-selection-service.ts';
import { createIsolatedTrackRenderProjectV21 } from './isolated-track-render-project-v21.ts';

const EFFECT_MACRO_TASK = 'selection-effect-macro';

export interface EffectMacroRequestEffect extends Readonly<Record<string, unknown>> {
	readonly id?: string;
	readonly type?: string;
	readonly enabled?: boolean;
	readonly params?: Readonly<Record<string, unknown>>;
}

export interface EffectMacroRequest {
	readonly name?: unknown;
	readonly trackId?: string | null;
	readonly effects?: readonly EffectMacroRequestEffect[];
}

export interface MaterializedMacroEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly enabled?: boolean;
}

interface MacroTrack extends Record<string, unknown> {
	id: string;
	name: string;
	effects: MaterializedMacroEffect[];
	gain: number;
	pan: number;
	mute: boolean;
	solo: boolean;
	envelope?: unknown[];
}

interface MacroProject {
	readonly id: string;
	readonly schemaVersion?: number;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly master: Readonly<Record<string, unknown>>;
	readonly mixer: Readonly<Record<string, unknown>>;
}

interface MutableMacroProject extends Record<string, unknown> {
	id: string;
	schemaVersion?: number;
	tracks: MacroTrack[];
	master: Record<string, unknown>;
	mixer: Record<string, unknown>;
}

interface MacroCopy {
	readonly audioTrackNotFound: string;
	readonly audacityApplied: string;
	readonly audacityProcessing: string;
	readonly audacitySelectionHint: string;
	readonly autoDuckControlTrack: string;
	readonly effectInvalidAudio: string;
	readonly effectRackEmpty: string;
	readonly noiseProfileMissing: string;
	readonly macroApplied?: string;
	readonly macroEffectsRequired?: string;
	readonly macroManager: string;
	readonly macroProcessing?: string;
	readonly macroSelectionRequired?: string;
	readonly untitledMacro: string;
}

interface MacroRenderBuffer {
	readonly [property: string]: unknown;
}

export interface EffectMacroServiceRuntime {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly copy: MacroCopy;
	readonly memoryLimitBytes: number;
	readonly getProject: () => MacroProject;
	readonly audacityEffectTarget: (trackId?: string | null) => EffectTarget | null;
	readonly editingBlocked: () => boolean;
	readonly materializeRackEffect: (
		effect: EffectMacroRequestEffect,
		scope: 'track',
		trackId: string,
		options: Readonly<{ forceEnabled: true; requireNoiseProfile: true }>,
	) => MaterializedMacroEffect;
	readonly projectSampleRate: () => number;
	readonly effectRackLatencyFrames: (effects: readonly MaterializedMacroEffect[], sampleRate: number) => number;
	readonly isAudacityRackEffectType: (type: string) => boolean;
	readonly estimateAudacityEffectPeakBytes: (
		type: string,
		frames: number,
		params: Readonly<Record<string, unknown>>,
		options: Readonly<{
			channelCount: number;
			controlChannelCount?: number;
			sampleRate: number;
		}>,
	) => number;
	readonly audacityEffectMemoryError: () => Error;
	readonly setProcessing: (processing: boolean) => void;
	readonly setStatus: (message: string, status?: string) => void;
	readonly publishDocumentSnapshot: () => void;
	readonly preflightStorage: (bytes: number, kind: 'effect') => Promise<unknown>;
	readonly cloneProject: (project: MacroProject) => MacroProject;
	readonly renderSnapshot: (
		project: unknown,
		options: Readonly<Record<string, unknown>>,
		sourceBuffers?: ReadonlyMap<string, unknown>,
	) => Promise<MacroRenderBuffer>;
	readonly projectFrameCount: () => number;
	readonly renderDryTrackRange: (
		trackId: string,
		startFrame: number,
		endFrame: number,
		channelCount: number,
		clipIds?: readonly string[],
	) => Promise<readonly Float32Array[]>;
	readonly runSelectionEffectWorker: (request: Readonly<{
		operation: 'apply';
		effectType: string;
		channels: readonly Float32Array[];
		sampleRate: number;
		params: Readonly<Record<string, unknown>>;
		context: Readonly<Record<string, unknown>>;
	}>) => Promise<Readonly<{ channels: readonly Float32Array[] }>>;
	readonly createAudioBuffer: (channels: readonly Float32Array[]) => Promise<unknown>;
	readonly audioBufferChannels: (buffer: MacroRenderBuffer) => readonly Float32Array[];
	readonly matchAudacitySelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
	readonly persistAudacityEffectResult: (
		target: EffectTarget,
		type: null,
		channels: readonly Float32Array[],
		options: Readonly<{ effectName: string; assertCurrent?: () => void }>,
	) => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
}

export function createEffectMacroService(runtime: EffectMacroServiceRuntime) {
	let running = false;

	async function runEffectMacro(request: EffectMacroRequest = {}): Promise<true | null> {
		if (runtime.editingBlocked()) return null;
		const project = runtime.getProject();
		const target = runtime.audacityEffectTarget(request.trackId);
		if (!target) throw new Error(runtime.copy.macroSelectionRequired || runtime.copy.audacitySelectionHint);
		const enabledEffects = (Array.isArray(request.effects) ? request.effects : []).filter((effect) => (
			effect?.enabled !== false && effect?.type !== 'missing'
		));
		if (!enabledEffects.length) {
			throw new Error(runtime.copy.macroEffectsRequired || runtime.copy.effectRackEmpty);
		}
		const effects = enabledEffects.map((effect) => materializeStep(effect, target.track.id));
		const sampleRate = runtime.projectSampleRate();
		const preRollFrames = Math.min(target.startFrame, sampleRate * 10);
		const outputFrames = chainOutputFrames(effects, target.durationFrames);
		const outputBytes = outputFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const processingFrames = target.durationFrames + preRollFrames;
		const latencyFrames = runtime.effectRackLatencyFrames(effects, sampleRate);
		const offlineBytes = (processingFrames + latencyFrames) * 2 * Float32Array.BYTES_PER_ELEMENT;
		const estimatedPeakBytes = Math.max(
			offlineBytes * 2 + outputBytes * 3,
			chainPeakBytes(effects, target, sampleRate, processingFrames),
		);
		if (estimatedPeakBytes > runtime.memoryLimitBytes) throw runtime.audacityEffectMemoryError();

		const ownership = captureOwnership(runtime, project.id);
		running = true;
		runtime.setProcessing(true);
		runtime.setStatus(runtime.copy.macroProcessing || runtime.copy.audacityProcessing);
		runtime.publishDocumentSnapshot();
		try {
			await runtime.preflightStorage(outputBytes, 'effect');
			assertOwnership(runtime, ownership);
			const channels = await runChain(effects, target, project, sampleRate, preRollFrames, ownership);
			const effectName = String(request.name || runtime.copy.untitledMacro || runtime.copy.macroManager).trim()
				|| runtime.copy.untitledMacro
				|| runtime.copy.macroManager;
			await runtime.persistAudacityEffectResult(target, null, channels, {
				assertCurrent: () => assertOwnership(runtime, ownership),
				effectName,
			});
			assertOwnership(runtime, ownership);
			runtime.setStatus(runtime.copy.macroApplied || runtime.copy.audacityApplied, 'success');
			return true;
		} catch (error) {
			if (ownershipIsCurrent(runtime, ownership) && !isCancellation(error)) runtime.handleError(error);
			throw error;
		} finally {
			running = false;
			const taskCurrent = taskIsCurrent(ownership.task);
			if (taskCurrent) runtime.setProcessing(false);
			if (taskCurrent && projectIsCurrent(runtime, ownership.project)) runtime.publishDocumentSnapshot();
			ownership.task.finish();
		}
	}

	/**
	 * A realtime step still materializes against the rack, so its live ranges,
	 * routing and captured noise profile are resolved the way playback resolves
	 * them; an offline step is only re-validated against its own definition.
	 */
	function materializeStep(
		effect: EffectMacroRequestEffect,
		trackId: string,
	): MaterializedMacroEffect {
		// The sequencer splits a macro at its command steps and hands this runner
		// only runs of effects, because this runner resolves one target up front
		// and carries one buffer to the end. A command reaching here would mean
		// the split failed, so it fails loudly rather than being skipped.
		if (isMacroCommandStep(effect)) {
			throw new RangeError(
				`A macro command (${String((effect as { command?: unknown }).command)}) cannot be applied as an effect.`,
			);
		}
		if (!isRealtimeEffectMacroStepType(effect.type)) {
			return normalizeEffectMacroStep(effect) as unknown as MaterializedMacroEffect;
		}
		return runtime.materializeRackEffect(effect, 'track', trackId, {
			forceEnabled: true,
			requireNoiseProfile: true,
		});
	}

	/** What the selection is left at once every length-changing step has run. */
	function chainOutputFrames(
		effects: readonly MaterializedMacroEffect[],
		durationFrames: number,
	): number {
		let frames = durationFrames;
		for (const effect of effects) {
			if (isRealtimeEffectMacroStepType(effect.type)) continue;
			frames = estimateAudioSelectionEffectOutputFrames(effect.type, frames, effect.params);
		}
		return frames;
	}

	/** Steps run one after another, so the chain peaks at its hungriest step. */
	function chainPeakBytes(
		effects: readonly MaterializedMacroEffect[],
		target: EffectTarget,
		sampleRate: number,
		processingFrames: number,
	): number {
		let peakBytes = 0;
		let frames = target.durationFrames;
		for (const effect of effects) {
			if (isRealtimeEffectMacroStepType(effect.type)) {
				if (!runtime.isAudacityRackEffectType(effect.type)) continue;
				peakBytes = Math.max(peakBytes, runtime.estimateAudacityEffectPeakBytes(
					effect.type,
					processingFrames,
					effect.params,
					{
						channelCount: target.channelCount,
						...(effect.type === 'audacity-auto-duck' ? { controlChannelCount: 2 } : {}),
						sampleRate,
					},
				));
				continue;
			}
			peakBytes = Math.max(peakBytes, estimateAudioSelectionEffectPeakBytes(
				effect.type,
				frames,
				effect.params,
				{ channelCount: target.channelCount, sampleRate },
			));
			frames = estimateAudioSelectionEffectOutputFrames(effect.type, frames, effect.params);
		}
		return peakBytes;
	}

	/**
	 * Render a leading run of realtime steps straight from the timeline, so the
	 * rack is warmed by the audio in front of the selection exactly as playback
	 * warms it.
	 */
	async function renderTimelineRack(
		effects: readonly MaterializedMacroEffect[],
		target: EffectTarget,
		project: MacroProject,
		preRollFrames: number,
		ownership: EffectMacroOwnership,
	): Promise<readonly Float32Array[]> {
		let snapshot = runtime.cloneProject(project) as MutableMacroProject;
		const snapshotTrack = snapshot.tracks.find((track) => track.id === target.track.id);
		if (!snapshotTrack) throw new Error(runtime.copy.audioTrackNotFound);
		if (isSoundscaperProductionProject(snapshot)) {
			snapshot = createIsolatedTrackRenderProjectV21(snapshot as never, {
				trackId: target.track.id,
				effects,
			}) as unknown as MutableMacroProject;
		} else {
			snapshotTrack.effects = [...effects];
			snapshotTrack.gain = 1;
			snapshotTrack.pan = 0;
			snapshotTrack.mute = false;
			snapshotTrack.solo = false;
			snapshotTrack.envelope = [];
			snapshot.master = { ...snapshot.master, gain: 1, pan: 0, mute: false, effects: [] };
			snapshot.mixer = { ...snapshot.mixer, groups: [], sends: [], routes: {} };
		}
		const rendered = await runtime.renderSnapshot(snapshot, {
			startFrame: target.startFrame,
			endFrame: target.endFrame,
			trackId: target.track.id,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: target.durationFrames,
			preRollFrames,
		});
		assertOwnership(runtime, ownership);
		return runtime.matchAudacitySelectionChannels(
			runtime.audioBufferChannels(rendered), target.channelCount,
		);
	}

	/**
	 * Run the macro over the selection. A chain that is entirely realtime is one
	 * rack render, unchanged; anything else carries the audio from step to step.
	 */
	async function runChain(
		effects: readonly MaterializedMacroEffect[],
		target: EffectTarget,
		project: MacroProject,
		sampleRate: number,
		preRollFrames: number,
		ownership: EffectMacroOwnership,
	): Promise<readonly Float32Array[]> {
		const segments = planEffectMacroChain(effects as unknown as readonly EffectMacroChainStep[]);
		const leadsWithRack = segments[0]?.realtime === true;
		let channels: readonly Float32Array[];
		if (leadsWithRack) {
			channels = await renderTimelineRack(
				segments[0].steps as unknown as readonly MaterializedMacroEffect[],
				target,
				project,
				preRollFrames,
				ownership,
			);
		} else {
			const dry = await runtime.renderDryTrackRange(
				target.track.id,
				target.startFrame,
				target.endFrame,
				target.channelCount,
				target.clipIds,
			);
			assertOwnership(runtime, ownership);
			channels = runtime.matchAudacitySelectionChannels(dry, target.channelCount);
		}
		const remaining = segments.slice(leadsWithRack ? 1 : 0);
		if (!remaining.length) return channels;
		const chain = createEffectMacroChainRunner({
			copy: runtime.copy,
			sampleRate,
			assertCurrent: () => assertOwnership(runtime, ownership),
			projectFrameCount: runtime.projectFrameCount,
			renderDryRange: runtime.renderDryTrackRange,
			runSelectionEffect: runtime.runSelectionEffectWorker,
			createAudioBuffer: runtime.createAudioBuffer,
			renderSnapshot: runtime.renderSnapshot,
			audioBufferChannels: runtime.audioBufferChannels,
			matchSelectionChannels: runtime.matchAudacitySelectionChannels,
		});
		return chain.runSegments(remaining, channels, target);
	}

	/**
	 * Stops the macro that is running, if one is. Cancellation takes the same
	 * fence a superseding run takes, so a half-rendered chain can never reach the
	 * project: every await boundary re-asserts ownership and the persist step is
	 * refused once the task is no longer current.
	 *
	 * The service tracks its own run rather than reading the editor's processing
	 * flag, which a single-effect application sets too — cancelling then would
	 * abort a macro task that is not the thing the user is waiting on.
	 *
	 * @returns whether there was a run to stop.
	 */
	function cancelEffectMacro(): boolean {
		if (!running) return false;
		runtime.lifetime.cancelTask(EFFECT_MACRO_TASK);
		return true;
	}

	return Object.freeze({ runEffectMacro, cancelEffectMacro });
}

interface EffectMacroOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

function captureOwnership(runtime: EffectMacroServiceRuntime, projectId: string): EffectMacroOwnership {
	return {
		task: runtime.lifetime.startTask(EFFECT_MACRO_TASK),
		project: runtime.projectGeneration.capture(projectId),
	};
}

function assertOwnership(runtime: EffectMacroServiceRuntime, ownership: EffectMacroOwnership): void {
	ownership.task.assertCurrent();
	runtime.projectGeneration.assertCurrent(ownership.project);
}

function ownershipIsCurrent(runtime: EffectMacroServiceRuntime, ownership: EffectMacroOwnership): boolean {
	return taskIsCurrent(ownership.task) && projectIsCurrent(runtime, ownership.project);
}

function taskIsCurrent(task: EditorTaskScope): boolean {
	try {
		task.assertCurrent();
		return true;
	} catch {
		return false;
	}
}

function projectIsCurrent(runtime: EffectMacroServiceRuntime, token: EditorProjectToken): boolean {
	try {
		runtime.projectGeneration.assertCurrent(token);
		return true;
	} catch {
		return false;
	}
}

function isCancellation(error: unknown): boolean {
	return typeof error === 'object' && error !== null
		&& (('name' in error && error.name === 'AbortError')
			|| ('code' in error && (error.code === 'PROJECT_CHANGED' || error.code === 'DISPOSED')));
}
