/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { EngineEffectScope } from '../engine/public-api.ts';
import type { EditorProjectToken } from './lifecycle.ts';
import { EffectGestureTargetChangedError, effectParametersMatch } from './effect-gesture-safety.ts';
import { audioEffectTypes, createEffect, normalizeEffect } from '../effects.js';
import { createStableId } from '../stable-id.js';
import { serializeAudacityNoiseProfile } from './source-audio.ts';

export type RackEffectScope = EngineEffectScope;
export type EffectParameters = Readonly<Record<string, unknown>>;
export interface ControllerRackEffect {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: EffectParameters;
	readonly context?: Readonly<Record<string, unknown>> | null;
	readonly state?: Readonly<Record<string, unknown>> | null;
	readonly bypassed?: boolean;
	readonly missing?: Readonly<Record<string, unknown>>;
	readonly opaqueAudacityNode?: unknown;
}

export interface RackEffectOwner {
	readonly id: string;
	readonly effects?: readonly ControllerRackEffect[];
}
export interface RackEffectTrack extends RackEffectOwner {
	readonly type: string;
}
export interface RackEffectProject {
	readonly id: string;
	readonly tracks: readonly RackEffectTrack[];
	readonly master?: Readonly<{ readonly effects?: readonly ControllerRackEffect[] }>;
	readonly mixer?: Readonly<{
		readonly groups?: readonly RackEffectOwner[];
		readonly sends?: readonly RackEffectOwner[];
	}>;
}

export interface AudacityNoiseProfile extends Record<string, unknown> {
	readonly meanPowers?: ArrayLike<number> | Iterable<number>;
}

export interface RackEffectGestureSession {
	readonly project: EditorProjectToken;
	readonly effectType: string;
	readonly original: EffectParameters;
}

export interface RackEffectControllerState {
	selectedTrackId: string | null;
	readOnly: boolean;
	effectClipboard: ControllerRackEffect[] | null;
	readonly rackEffectGestures: Map<string, RackEffectGestureSession>;
	readonly parametricEqGestures: Map<string, RackEffectGestureSession>;
	audacityControlTrackId: string | null;
	audacityNoiseProfile: AudacityNoiseProfile | null;
}

export interface RackEffectCopy {
	readonly effectTypeRequired: string;
	readonly selectTrackFirst: string;
	readonly audioTrackRequired: string;
	readonly effectUnsupported: string;
	readonly autoDuckOtherControlTrack: string;
	readonly noiseReductionAddedDisabled: string;
	readonly rackEffectNotFound: string;
	readonly missingEffectReadOnly: string;
	readonly projectReadOnly: string;
	readonly audioTrackNotFound: string;
	readonly pasteEffects?: string;
	readonly paste: string;
	readonly noiseProfileMissing: string;
}

export interface RackEffectPreviewEngine {
	configureRackEffect?(
		scope: RackEffectScope,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false;
	configureParametricEq?(
		scope: RackEffectScope,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
		options?: Readonly<{ transitionFrames?: number }>,
	): number | false;
}

export interface RackEffectCommitOptions {
	readonly skipPlaybackEngine?: boolean;
}

export interface RackEffectServiceRuntime {
	readonly state: RackEffectControllerState;
	readonly copy: RackEffectCopy;
	readonly engine: RackEffectPreviewEngine;
	readonly getProject: () => RackEffectProject | null;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly editingBlocked: () => boolean;
	readonly commit: (
		command: AudioEditorCommand,
		selection?: Readonly<Record<string, never>>,
		options?: RackEffectCommitOptions,
	) => RackEffectProject;
	readonly handleError: (error: Error) => null;
	readonly publishDocumentSnapshot: () => void;
	readonly setStatus: (message: string, status?: string) => void;
}

export interface AddRackEffectRequest {
	readonly type?: string;
	readonly scope?: string;
	readonly trackId?: string | null;
	readonly busId?: string | null;
	readonly options?: Readonly<{
		readonly id?: string;
		readonly enabled?: boolean;
		readonly params?: EffectParameters;
		readonly context?: Readonly<Record<string, unknown>> | null;
		readonly state?: Readonly<Record<string, unknown>> | null;
	}>;
}

export interface MaterializeRackEffectOptions {
	readonly forceEnabled?: boolean;
	readonly requireNoiseProfile?: boolean;
}

export function effectGestureKey(
	scope: string | null | undefined,
	targetId: string | null,
	effectId: string,
): string {
	return `${scope || 'track'}:${targetId == null ? '' : targetId}:${effectId}`;
}

export function createRackEffectService(runtime: RackEffectServiceRuntime) {
	const {
		assertProject, captureProject, commit, copy, editingBlocked, engine, getProject,
		handleError, publishDocumentSnapshot, setStatus, state,
	} = runtime;

	function requireProject(): RackEffectProject {
		const project = getProject();
		if (!project) throw new Error('Audio project not found.');
		return project;
	}

	function effectStack(
		scope: string,
		trackId: string | null,
		snapshot: RackEffectProject | null = getProject(),
	): readonly ControllerRackEffect[] {
		if (scope === 'master') return snapshot?.master?.effects || [];
		if (scope === 'group' || scope === 'send') {
			const buses = scope === 'group' ? snapshot?.mixer?.groups : snapshot?.mixer?.sends;
			const bus = (buses || []).find((candidate) => String(candidate.id) === String(trackId));
			if (!bus) throw new Error('Mixer bus not found.');
			return bus.effects || [];
		}
		if (scope !== 'track') {
			throw new RangeError('Effect stack scope must be track, master, group, or send.');
		}
		const track = snapshot?.tracks.find((candidate) => candidate.id === trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		return track.effects || [];
	}

	function normalizeRackEffect(effect: ControllerRackEffect): ControllerRackEffect {
		return normalizeEffect(effect) as ControllerRackEffect;
	}

	function rackScope(scope: string): RackEffectScope {
		if (scope === 'track' || scope === 'master' || scope === 'group' || scope === 'send') return scope;
		throw new RangeError('Effect stack scope must be track, master, group, or send.');
	}

	function addEffect(request: AddRackEffectRequest = {}): string | null | undefined {
		if (editingBlocked()) return undefined;
		if (!request.type) throw new TypeError(copy.effectTypeRequired);
		const scope: RackEffectScope = ['master', 'group', 'send'].includes(request.scope || '')
			? request.scope as RackEffectScope
			: 'track';
		const trackId = request.trackId ?? request.busId ?? state.selectedTrackId;
		const project = requireProject();
		if (scope === 'track' && !trackId) return handleError(new Error(copy.selectTrackFirst));
		if (scope === 'track' && project.tracks.find((track) => track.id === trackId)?.type !== 'audio') {
			return handleError(new Error(copy.audioTrackRequired));
		}
		if ((scope === 'group' || scope === 'send') && !trackId) {
			throw new TypeError('A mixer bus ID is required.');
		}
		const type = request.type;
		if (!audioEffectTypes().includes(type)) throw new Error(copy.effectUnsupported);
		const effectOptions = { ...(request.options || {}) };
		if (type === 'audacity-auto-duck') {
			const candidates = project.tracks.filter((track) => (
				track.type === 'audio' && (scope === 'master' || track.id !== trackId)
			));
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const controlTrackId = candidates.some((track) => track.id === requestedControlTrackId)
				? String(requestedControlTrackId)
				: candidates[0]?.id;
			if (!controlTrackId) return handleError(new Error(copy.autoDuckOtherControlTrack));
			effectOptions.context = { ...effectOptions.context, controlTrackId };
		}
		if (type === 'audacity-noise-reduction') {
			effectOptions.context = {
				...effectOptions.context,
				noiseProfile: effectOptions.context?.noiseProfile
					|| serializeAudacityNoiseProfile(state.audacityNoiseProfile),
			};
			if (!effectOptions.context.noiseProfile) effectOptions.enabled = false;
		}
		const effect = createEffect(type, effectOptions) as ControllerRackEffect;
		commit(rackCommand('effect/add', scope, trackId, { effect: effect as unknown as CommandObject }));
		if (type === 'audacity-noise-reduction' && !effectOptions.context?.noiseProfile) {
			setStatus(copy.noiseReductionAddedDisabled);
		}
		return effect.id;
	}

	function updateRackEffect(
		scope: string,
		trackId: string | null,
		effectId: string,
		changes: CommandObject = {},
	): RackEffectProject {
		const effect = effectStack(scope, trackId).find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error(copy.rackEffectNotFound);
		if (effect.type === 'missing') {
			const keys = Object.keys(changes);
			const replacing = typeof changes.type === 'string' && changes.type !== 'missing';
			const activationOnly = keys.every((key) => key === 'enabled');
			if (!replacing && !activationOnly) throw new Error(copy.missingEffectReadOnly);
		}
		const result = commit(rackCommand('effect/update', rackScope(scope), trackId, { effectId, changes }));
		state.rackEffectGestures.delete(effectGestureKey(scope, trackId, effectId));
		state.parametricEqGestures.delete(effectGestureKey(scope, trackId, effectId));
		return result;
	}

	function assertGestureTarget(
		gestures: Map<string, RackEffectGestureSession>,
		key: string,
		gesture: RackEffectGestureSession,
		effect: ControllerRackEffect,
	): void {
		try {
			assertProject(gesture.project);
		} catch (error) {
			gestures.delete(key);
			throw error;
		}
		if (
			effect.type !== gesture.effectType
			|| !effectParametersMatch(effect.params, gesture.original)
		) {
			gestures.delete(key);
			throw new EffectGestureTargetChangedError();
		}
	}

	function beginGesture(
		gestures: Map<string, RackEffectGestureSession>,
		scope: string,
		targetId: string | null,
		effectId: string,
		expectedType: 'eq' | 'not-eq',
	): EffectParameters {
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		const allowed = expectedType === 'eq'
			? effect?.type === 'eq'
			: Boolean(effect && effect.type !== 'missing' && effect.type !== 'eq');
		if (!effect || !allowed) throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		const current = gestures.get(key);
		if (current) assertGestureTarget(gestures, key, current, effect);
		else {
			gestures.set(key, {
				project: captureProject(),
				effectType: effect.type,
				original: structuredClone(effect.params),
			});
		}
		return structuredClone(gestures.get(key)!.original);
	}

	function currentGestureEffect(
		gestures: Map<string, RackEffectGestureSession>,
		scope: string,
		targetId: string | null,
		effectId: string,
		expectedType: 'eq' | 'not-eq',
	): { effect: ControllerRackEffect; gesture: RackEffectGestureSession; key: string } {
		const key = effectGestureKey(scope, targetId, effectId);
		if (!gestures.has(key)) beginGesture(gestures, scope, targetId, effectId, expectedType);
		const gesture = gestures.get(key)!;
		try {
			assertProject(gesture.project);
		} catch (error) {
			gestures.delete(key);
			throw error;
		}
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		const allowed = expectedType === 'eq'
			? effect?.type === 'eq'
			: Boolean(effect && effect.type !== 'missing' && effect.type !== 'eq');
		if (!effect || !allowed) {
			gestures.delete(key);
			throw new EffectGestureTargetChangedError();
		}
		assertGestureTarget(gestures, key, gesture, effect);
		return { effect, gesture, key };
	}

	function beginRackEffectGesture(scope: string, targetId: string | null, effectId: string): EffectParameters {
		return beginGesture(state.rackEffectGestures, scope, targetId, effectId, 'not-eq');
	}

	function previewRackEffect(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false {
		const { effect } = currentGestureEffect(
			state.rackEffectGestures, scope, targetId, effectId, 'not-eq',
		);
		const normalized = normalizeRackEffect({
			...effect,
			params: { ...effect.params, ...params },
		}).params;
		return engine.configureRackEffect?.(rackScope(scope), targetId, effectId, normalized) ?? false;
	}

	function commitRackEffectGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): RackEffectProject {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const { effect, gesture, key } = currentGestureEffect(
			state.rackEffectGestures, scope, targetId, effectId, 'not-eq',
		);
		const normalized = normalizeRackEffect({
			...effect,
			params: { ...effect.params, ...params },
		}).params;
		const unchanged = effectParametersMatch(
			normalizeRackEffect({ ...effect, params: gesture.original }).params,
			normalized,
		);
		state.rackEffectGestures.delete(key);
		if (unchanged) return requireProject();
		const adopted = engine.configureRackEffect?.(rackScope(scope), targetId, effectId, normalized) ?? false;
		try {
			return commit(
				rackCommand('effect/update', rackScope(scope), targetId, {
					effectId,
					changes: { params: normalized },
				}),
				{},
				{ skipPlaybackEngine: adopted !== false },
			);
		} catch (error) {
			if (adopted !== false) {
				engine.configureRackEffect?.(rackScope(scope), targetId, effectId, gesture.original);
			}
			throw error;
		}
	}

	function cancelGesture(
		gestures: Map<string, RackEffectGestureSession>,
		scope: string,
		targetId: string | null,
		effectId: string,
		expectedType: 'eq' | 'not-eq',
		configure: (params: EffectParameters) => number | false,
	): number | false {
		const key = effectGestureKey(scope, targetId, effectId);
		const gesture = gestures.get(key);
		gestures.delete(key);
		if (!gesture) return false;
		try {
			assertProject(gesture.project);
		} catch {
			return false;
		}
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		const allowed = expectedType === 'eq'
			? effect?.type === 'eq'
			: Boolean(effect && effect.type !== 'missing' && effect.type !== 'eq');
		if (!effect || !allowed || effect.type !== gesture.effectType) return false;
		if (!effectParametersMatch(effect.params, gesture.original)) return false;
		return configure(gesture.original);
	}

	function cancelRackEffectGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
	): number | false {
		return cancelGesture(
			state.rackEffectGestures,
			scope,
			targetId,
			effectId,
			'not-eq',
			(params) => engine.configureRackEffect?.(rackScope(scope), targetId, effectId, params) ?? false,
		);
	}

	function beginParametricEqGesture(scope: string, targetId: string | null, effectId: string): EffectParameters {
		return beginGesture(state.parametricEqGestures, scope, targetId, effectId, 'eq');
	}

	function previewParametricEq(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false {
		const { effect } = currentGestureEffect(
			state.parametricEqGestures, scope, targetId, effectId, 'eq',
		);
		const normalized = normalizeRackEffect({ ...effect, params }).params;
		return engine.configureParametricEq?.(rackScope(scope), targetId, effectId, normalized) ?? false;
	}

	function commitParametricEqGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): RackEffectProject {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const { effect, gesture, key } = currentGestureEffect(
			state.parametricEqGestures, scope, targetId, effectId, 'eq',
		);
		const normalized = normalizeRackEffect({ ...effect, params }).params;
		const unchanged = effectParametersMatch(
			normalizeRackEffect({ ...effect, params: gesture.original }).params,
			normalized,
		);
		state.parametricEqGestures.delete(key);
		if (unchanged) return requireProject();
		const adopted = engine.configureParametricEq?.(rackScope(scope), targetId, effectId, normalized) ?? false;
		try {
			return commit(
				rackCommand('effect/update', rackScope(scope), targetId, {
					effectId,
					changes: { params: normalized },
				}),
				{},
				{ skipPlaybackEngine: adopted !== false },
			);
		} catch (error) {
			if (adopted !== false) {
				engine.configureParametricEq?.(
					rackScope(scope), targetId, effectId, gesture.original, { transitionFrames: 0 },
				);
			}
			throw error;
		}
	}

	function cancelParametricEqGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
	): number | false {
		return cancelGesture(
			state.parametricEqGestures,
			scope,
			targetId,
			effectId,
			'eq',
			(params) => engine.configureParametricEq?.(rackScope(scope), targetId, effectId, params) ?? false,
		);
	}

	function copyEffectStack(scope: string, trackId: string | null = state.selectedTrackId): ControllerRackEffect[] {
		const effects = effectStack(scope, trackId);
		state.effectClipboard = effects.map((effect) => structuredClone(effect));
		publishDocumentSnapshot();
		return state.effectClipboard.map((effect) => structuredClone(effect));
	}

	function pasteEffectStack(
		scope: string,
		trackId: string | null = state.selectedTrackId,
	): ControllerRackEffect[] | null {
		if (editingBlocked()) return null;
		if (state.effectClipboard === null) throw new Error(copy.pasteEffects || copy.paste);
		const current = effectStack(scope, trackId);
		const effects = state.effectClipboard.map((effect) => materializeRackEffect(effect, scope, trackId));
		const commands: AudioEditorCommand[] = [
			...current.map((effect) => rackCommand('effect/remove', rackScope(scope), trackId, {
				effectId: effect.id,
			})),
			...effects.map((effect) => rackCommand('effect/add', rackScope(scope), trackId, {
				effect: effect as unknown as CommandObject,
			})),
		];
		if (commands.length) commit({ type: 'batch', commands });
		return effects.map((effect) => structuredClone(effect));
	}

	function materializeRackEffect(
		effect: ControllerRackEffect,
		scope: string,
		trackId: string | null,
		options: MaterializeRackEffectOptions = {},
	): ControllerRackEffect {
		if (effect.type === 'missing') {
			return {
				...structuredClone(effect),
				id: createStableId('effect'),
				enabled: options.forceEnabled ? true : effect.enabled !== false,
				bypassed: true,
			};
		}
		const effectOptions: {
			enabled: boolean;
			params: Record<string, unknown>;
			context?: Record<string, unknown> | null;
			state?: Record<string, unknown> | null;
		} = {
			enabled: options.forceEnabled ? true : effect.enabled !== false,
			params: structuredClone(effect.params || {}),
		};
		if (effect.context !== undefined) {
			effectOptions.context = structuredClone(effect.context);
		}
		if (effect.state !== undefined) {
			effectOptions.state = structuredClone(effect.state);
		}
		if (effect.type === 'audacity-auto-duck') {
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const candidates = requireProject().tracks.filter((track) => (
				track.type === 'audio' && (scope === 'master' || track.id !== trackId)
			));
			const controlTrackId = candidates.some((track) => track.id === requestedControlTrackId)
				? String(requestedControlTrackId)
				: candidates[0]?.id;
			if (!controlTrackId) throw new Error(copy.autoDuckOtherControlTrack);
			effectOptions.context = { ...effectOptions.context, controlTrackId };
		}
		if (effect.type === 'audacity-noise-reduction') {
			const noiseProfile = effectOptions.context?.noiseProfile
				|| serializeAudacityNoiseProfile(state.audacityNoiseProfile);
			if (!noiseProfile && options.requireNoiseProfile) throw new Error(copy.noiseProfileMissing);
			if (noiseProfile) effectOptions.context = { ...effectOptions.context, noiseProfile };
			else effectOptions.enabled = false;
		}
		return createEffect(effect.type, effectOptions) as ControllerRackEffect;
	}

	return Object.freeze({
		addEffect,
		beginParametricEqGesture,
		beginRackEffectGesture,
		cancelParametricEqGesture,
		cancelRackEffectGesture,
		commitParametricEqGesture,
		commitRackEffectGesture,
		copyEffectStack,
		effectGestureKey,
		effectStack,
		materializeRackEffect,
		pasteEffectStack,
		previewParametricEq,
		previewRackEffect,
		updateRackEffect,
	});
}

function rackCommand(
	type: 'effect/add' | 'effect/update' | 'effect/remove',
	scope: RackEffectScope,
	targetId: string | null,
	payload: CommandObject,
): AudioEditorCommand {
	return {
		type,
		scope,
		trackId: targetId,
		busId: targetId,
		...payload,
	} as unknown as AudioEditorCommand;
}
