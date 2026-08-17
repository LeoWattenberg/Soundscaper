/* SPDX-License-Identifier: AGPL-3.0-only */

import { isSoundscaperProductionProjectSchema } from '../project-schema-version.ts';
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
	readonly effectRackEmpty: string;
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
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask'>;
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
		project: MutableMacroProject,
		options: Readonly<{
			startFrame: number;
			endFrame: number;
			trackId: string;
			includeMaster: false;
			includeTrackPan: false;
			respectMuteSolo: false;
			outputFrames: number;
			preRollFrames: number;
		}>,
	) => Promise<MacroRenderBuffer>;
	readonly audioBufferChannels: (buffer: MacroRenderBuffer) => readonly Float32Array[];
	readonly matchAudacitySelectionChannels: (
		channels: readonly Float32Array[],
		channelCount: number,
	) => Float32Array[];
	readonly persistAudacityEffectResult: (
		target: EffectTarget,
		type: null,
		channels: readonly Float32Array[],
		options: Readonly<{ effectName: string }>,
	) => Promise<unknown>;
	readonly handleError: (error: unknown) => void;
}

export function createEffectMacroService(runtime: EffectMacroServiceRuntime) {
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
		const effects = enabledEffects.map((effect) => runtime.materializeRackEffect(
			effect,
			'track',
			target.track.id,
			{ forceEnabled: true, requireNoiseProfile: true },
		));
		const sampleRate = runtime.projectSampleRate();
		const preRollFrames = Math.min(target.startFrame, sampleRate * 10);
		const outputBytes = target.durationFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const processingFrames = target.durationFrames + preRollFrames;
		const latencyFrames = runtime.effectRackLatencyFrames(effects, sampleRate);
		const offlineBytes = (processingFrames + latencyFrames) * 2 * Float32Array.BYTES_PER_ELEMENT;
		let estimatedPeakBytes = offlineBytes * 2 + outputBytes * 3;
		for (const effect of effects) {
			if (!runtime.isAudacityRackEffectType(effect.type)) continue;
			estimatedPeakBytes = Math.max(estimatedPeakBytes, runtime.estimateAudacityEffectPeakBytes(
				effect.type,
				processingFrames,
				effect.params,
				{
					channelCount: target.channelCount,
					...(effect.type === 'audacity-auto-duck' ? { controlChannelCount: 2 } : {}),
					sampleRate,
				},
			));
		}
		if (estimatedPeakBytes > runtime.memoryLimitBytes) throw runtime.audacityEffectMemoryError();

		const ownership = captureOwnership(runtime, project.id);
		runtime.setProcessing(true);
		runtime.setStatus(runtime.copy.macroProcessing || runtime.copy.audacityProcessing);
		runtime.publishDocumentSnapshot();
		try {
			await runtime.preflightStorage(outputBytes, 'effect');
			assertOwnership(runtime, ownership);
			let snapshot = runtime.cloneProject(project) as MutableMacroProject;
			const snapshotTrack = snapshot.tracks.find((track) => track.id === target.track.id);
			if (!snapshotTrack) throw new Error(runtime.copy.audioTrackNotFound);
			if (isSoundscaperProductionProjectSchema(snapshot.schemaVersion)) {
				snapshot = createIsolatedTrackRenderProjectV21(snapshot as never, {
					trackId: target.track.id,
					effects,
				}) as unknown as MutableMacroProject;
			} else {
				snapshotTrack.effects = effects;
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
			const channels = runtime.matchAudacitySelectionChannels(
				runtime.audioBufferChannels(rendered), target.channelCount,
			);
			const effectName = String(request.name || runtime.copy.untitledMacro || runtime.copy.macroManager).trim()
				|| runtime.copy.untitledMacro
				|| runtime.copy.macroManager;
			await runtime.persistAudacityEffectResult(target, null, channels, { effectName });
			assertOwnership(runtime, ownership);
			runtime.setStatus(runtime.copy.macroApplied || runtime.copy.audacityApplied, 'success');
			return true;
		} catch (error) {
			if (ownershipIsCurrent(runtime, ownership) && !isCancellation(error)) runtime.handleError(error);
			throw error;
		} finally {
			const taskCurrent = taskIsCurrent(ownership.task);
			if (taskCurrent) runtime.setProcessing(false);
			if (taskCurrent && projectIsCurrent(runtime, ownership.project)) runtime.publishDocumentSnapshot();
			ownership.task.finish();
		}
	}

	return Object.freeze({ runEffectMacro });
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
