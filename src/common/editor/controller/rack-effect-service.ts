/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { EngineEffectScope } from '../engine/public-api.ts';
import type { EditorProjectToken } from './lifecycle.ts';
import { EffectGestureTargetChangedError, effectParametersMatch } from './effect-gesture-safety.ts';
import {
	ParameterGestureAuthorityChangedError,
	createParameterGestureAdapter,
	type ParameterGestureSession,
	type ParameterGestureTarget,
} from './parameter-gesture-adapter.ts';
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

export type RackEffectGestureSession = ParameterGestureSession<EffectParameters, number>;

export interface RackEffectControllerState {
	selectedTrackId: string | null;
	readOnly: boolean;
	writeAuthorityGeneration: number;
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
	return JSON.stringify([scope || 'track', targetId, effectId]);
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

	function createRackGestureAdapter(
		gestures: Map<string, RackEffectGestureSession>,
		expectedType: 'eq' | 'not-eq',
		configure: (
			scope: RackEffectScope,
			targetId: string | null,
			effectId: string,
			params: EffectParameters,
		) => number | false,
		restore = configure,
	) {
		const resolveLocation = (identity: string) => {
			const location = parseEffectGestureKey(identity);
			let effect: ControllerRackEffect | undefined;
			try {
				effect = effectStack(location.scope, location.targetId)
					.find((candidate) => candidate.id === location.effectId);
			} catch {
				return null;
			}
			const allowed = expectedType === 'eq'
				? effect?.type === 'eq'
				: Boolean(effect && effect.type !== 'missing' && effect.type !== 'eq');
			return effect && allowed ? { effect, ...location } : null;
		};
		const resolveTarget = (identity: string): ParameterGestureTarget<EffectParameters> | null => {
			const resolved = resolveLocation(identity);
			if (!resolved) return null;
			return Object.freeze({
				identity,
				revision: JSON.stringify([resolved.effect.type, resolved.effect.params]),
				value: resolved.effect.params,
			});
		};
		return createParameterGestureAdapter<EffectParameters, RackEffectProject, number>({
			sessions: gestures,
			captureProject,
			assertProject,
			captureAuthority: () => state.writeAuthorityGeneration,
			assertAuthority: (generation) => {
				if (generation !== state.writeAuthorityGeneration) {
					throw new ParameterGestureAuthorityChangedError();
				}
			},
			resolveTarget,
			normalize: (target, params) => {
				const resolved = resolveLocation(target.identity);
				if (!resolved) throw new EffectGestureTargetChangedError();
				return normalizeRackEffect({
					...resolved.effect,
					params: expectedType === 'eq'
						? params
						: { ...resolved.effect.params, ...params },
				}).params;
			},
			valuesEqual: effectParametersMatch,
			applyPreview: (target, params) => {
				const resolved = resolveLocation(target.identity);
				if (!resolved) throw new EffectGestureTargetChangedError();
				return configure(resolved.scope, resolved.targetId, resolved.effectId, params);
			},
			restorePreview: (target, params) => {
				const resolved = resolveLocation(target.identity);
				if (!resolved) throw new EffectGestureTargetChangedError();
				return restore(resolved.scope, resolved.targetId, resolved.effectId, params);
			},
			commitValue: (target, params, { adopted }) => {
				const resolved = resolveLocation(target.identity);
				if (!resolved) throw new EffectGestureTargetChangedError();
				return commit(
					rackCommand('effect/update', resolved.scope, resolved.targetId, {
						effectId: resolved.effectId,
						changes: { params },
					}),
					{},
					{ skipPlaybackEngine: adopted },
				);
			},
			currentValue: requireProject,
			createTargetMissingError: () => new Error(copy.rackEffectNotFound),
			createTargetChangedError: () => new EffectGestureTargetChangedError(),
		});
	}

	const rackGestureAdapter = createRackGestureAdapter(
		state.rackEffectGestures,
		'not-eq',
		(scope, targetId, effectId, params) => (
			engine.configureRackEffect?.(scope, targetId, effectId, params) ?? false
		),
	);
	const parametricEqGestureAdapter = createRackGestureAdapter(
		state.parametricEqGestures,
		'eq',
		(scope, targetId, effectId, params) => (
			engine.configureParametricEq?.(scope, targetId, effectId, params) ?? false
		),
		(scope, targetId, effectId, params) => (
			engine.configureParametricEq?.(
				scope, targetId, effectId, params, { transitionFrames: 0 },
			) ?? false
		),
	);

	function requireWritableGesture(
		adapter: ReturnType<typeof createRackGestureAdapter>,
		identity: string,
	): void {
		if (!state.readOnly) return;
		adapter.revoke(identity);
		throw new Error(copy.projectReadOnly);
	}

	function revokeWriteAuthority(): void {
		const errors: unknown[] = [];
		for (const adapter of [rackGestureAdapter, parametricEqGestureAdapter]) {
			try {
				adapter.revokeAll();
			} catch (error) {
				errors.push(error);
			}
		}
		const generation = state.writeAuthorityGeneration + 1;
		if (!Number.isSafeInteger(generation)) throw new RangeError('Write authority generation exhausted.');
		state.writeAuthorityGeneration = generation;
		if (errors.length) handleError(new AggregateError(errors, 'Rack gesture rollback failed.'));
	}

	function beginRackEffectGesture(scope: string, targetId: string | null, effectId: string): EffectParameters {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(rackGestureAdapter, identity);
		return rackGestureAdapter.begin(identity);
	}

	function previewRackEffect(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(rackGestureAdapter, identity);
		return rackGestureAdapter.preview(identity, params);
	}

	function commitRackEffectGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): RackEffectProject {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(rackGestureAdapter, identity);
		return rackGestureAdapter.commit(identity, params);
	}

	function cancelRackEffectGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
	): number | false {
		return rackGestureAdapter.cancel(effectGestureKey(scope, targetId, effectId));
	}

	function beginParametricEqGesture(scope: string, targetId: string | null, effectId: string): EffectParameters {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(parametricEqGestureAdapter, identity);
		return parametricEqGestureAdapter.begin(identity);
	}

	function previewParametricEq(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): number | false {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(parametricEqGestureAdapter, identity);
		return parametricEqGestureAdapter.preview(identity, params);
	}

	function commitParametricEqGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
		params: EffectParameters,
	): RackEffectProject {
		const identity = effectGestureKey(scope, targetId, effectId);
		requireWritableGesture(parametricEqGestureAdapter, identity);
		return parametricEqGestureAdapter.commit(identity, params);
	}

	function cancelParametricEqGesture(
		scope: string,
		targetId: string | null,
		effectId: string,
	): number | false {
		return parametricEqGestureAdapter.cancel(effectGestureKey(scope, targetId, effectId));
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
		revokeWriteAuthority,
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

function parseEffectGestureKey(value: string): Readonly<{
	scope: RackEffectScope;
	targetId: string | null;
	effectId: string;
}> {
	let parts: unknown;
	try {
		parts = JSON.parse(value);
	} catch {
		throw new TypeError('An effect gesture target identity is invalid.');
	}
	if (!Array.isArray(parts) || parts.length !== 3) {
		throw new TypeError('An effect gesture target identity is invalid.');
	}
	const scope = rackScopeValue(parts[0]);
	const targetId = scope === 'master' ? null : stableGestureId(parts[1], `${scope} target`);
	const effectId = stableGestureId(parts[2], 'effect');
	return Object.freeze({ scope, targetId, effectId });
}

function rackScopeValue(value: unknown): RackEffectScope {
	if (value === 'track' || value === 'master' || value === 'group' || value === 'send') return value;
	throw new RangeError('Effect stack scope must be track, master, group, or send.');
}

function stableGestureId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value.length > 1_024) {
		throw new TypeError(`A stable ${name} ID is required.`);
	}
	return value;
}
