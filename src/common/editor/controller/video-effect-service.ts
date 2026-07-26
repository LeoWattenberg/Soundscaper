/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import type { EditorProjectToken } from './lifecycle.ts';
import { EffectGestureTargetChangedError, effectParametersMatch } from './effect-gesture-safety.ts';
import { createVideoEffect, normalizeVideoEffect } from '../video-effects.js';

export interface ControllerVideoEffect {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, number>>;
}

export interface ControllerVideoClip {
	readonly id: string;
	readonly kind: string;
	readonly videoEffects?: readonly ControllerVideoEffect[];
}

export interface VideoEffectProject {
	readonly id: string;
	readonly clips: readonly ControllerVideoClip[];
}

export interface VideoEffectGestureSession {
	readonly project: EditorProjectToken;
	readonly effectType: string;
	readonly original: Readonly<Record<string, number>>;
	params: Readonly<Record<string, number>>;
}

export interface VideoEffectControllerState {
	readonly selectedClipId: string | null;
	readonly readOnly: boolean;
	readonly videoEffectGestures: Map<string, VideoEffectGestureSession>;
}

export interface VideoEffectCopy {
	readonly projectReadOnly: string;
}

export interface VideoEffectCommitSelection {
	readonly selectClipId?: string | null;
}

export interface VideoEffectServiceRuntime {
	readonly state: VideoEffectControllerState;
	readonly copy: VideoEffectCopy;
	readonly getProject: () => VideoEffectProject | null;
	readonly captureProject: () => EditorProjectToken;
	readonly assertProject: (token: EditorProjectToken) => void;
	readonly editingBlocked: () => boolean;
	readonly commit: (
		command: AudioEditorCommand,
		selection?: VideoEffectCommitSelection,
	) => VideoEffectProject;
	readonly publishDocumentSnapshot: () => void;
}

export interface AddVideoEffectOptions {
	readonly id?: string;
	readonly enabled?: boolean;
	readonly params?: Readonly<Record<string, number>>;
	readonly index?: number;
}

export function videoEffectGestureKey(clipId: string, effectId: string): string {
	return `${clipId}:${effectId}`;
}

export function createVideoEffectService(runtime: VideoEffectServiceRuntime) {
	const {
		assertProject, captureProject, commit, copy, editingBlocked, getProject,
		publishDocumentSnapshot, state,
	} = runtime;

	function videoClipEffect(clipId: string, effectId: string) {
		const clip = getProject()?.clips.find((candidate) => candidate.id === clipId);
		if (!clip || clip.kind !== 'video') throw new Error('Video clip not found.');
		const effect = (clip.videoEffects || []).find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error('Video effect not found.');
		return { clip, effect };
	}

	function addVideoClipEffect(
		clipId: string | null = state.selectedClipId,
		type: string,
		options: AddVideoEffectOptions = {},
	): string | null {
		if (editingBlocked()) return null;
		const clip = getProject()?.clips.find((candidate) => candidate.id === clipId);
		if (!clip || clip.kind !== 'video') throw new Error('Video clip not found.');
		const effect = createVideoEffect(type, options) as ControllerVideoEffect;
		commit({
			type: 'video-effect/add',
			clipId: clip.id,
			effect: effect as unknown as CommandObject,
			...(options.index == null ? {} : { index: options.index }),
		}, { selectClipId: clip.id });
		return effect.id;
	}

	function updateVideoClipEffect(
		clipId: string,
		effectId: string,
		changes: CommandObject = {},
	): VideoEffectProject | null {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		state.videoEffectGestures.delete(videoEffectGestureKey(clipId, effectId));
		return commit({ type: 'video-effect/update', clipId, effectId, changes }, { selectClipId: clipId });
	}

	function toggleVideoClipEffect(
		clipId: string,
		effectId: string,
		enabled: boolean | undefined = undefined,
	): VideoEffectProject | null {
		const { effect } = videoClipEffect(clipId, effectId);
		if (enabled != null && typeof enabled !== 'boolean') {
			throw new TypeError('Video effect enabled state must be boolean.');
		}
		return updateVideoClipEffect(clipId, effectId, { enabled: enabled ?? !effect.enabled });
	}

	function bypassVideoClipEffect(
		clipId: string,
		effectId: string,
		bypassed = true,
	): VideoEffectProject | null {
		if (typeof bypassed !== 'boolean') throw new TypeError('Video effect bypass state must be boolean.');
		return updateVideoClipEffect(clipId, effectId, { enabled: !bypassed });
	}

	function reorderVideoClipEffect(
		clipId: string,
		effectId: string,
		toIndex: number,
	): VideoEffectProject | null {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		return commit(
			{ type: 'video-effect/reorder', clipId, effectId, toIndex },
			{ selectClipId: clipId },
		);
	}

	function removeVideoClipEffect(clipId: string, effectId: string): VideoEffectProject | null {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		state.videoEffectGestures.delete(videoEffectGestureKey(clipId, effectId));
		return commit({ type: 'video-effect/remove', clipId, effectId }, { selectClipId: clipId });
	}

	function assertGestureTarget(
		key: string,
		gesture: VideoEffectGestureSession,
		effect: ControllerVideoEffect,
	): void {
		try {
			assertProject(gesture.project);
		} catch (error) {
			state.videoEffectGestures.delete(key);
			throw error;
		}
		if (
			effect.type !== gesture.effectType
			|| !effectParametersMatch(effect.params, gesture.original)
		) {
			state.videoEffectGestures.delete(key);
			throw new EffectGestureTargetChangedError();
		}
	}

	function beginVideoEffectGesture(
		clipId: string,
		effectId: string,
	): Readonly<Record<string, number>> | null {
		if (editingBlocked()) return null;
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		const current = state.videoEffectGestures.get(key);
		if (current) assertGestureTarget(key, current, effect);
		else {
			state.videoEffectGestures.set(key, {
				project: captureProject(),
				effectType: effect.type,
				original: structuredClone(effect.params),
				params: structuredClone(effect.params),
			});
		}
		return structuredClone(state.videoEffectGestures.get(key)!.original);
	}

	function previewVideoEffectGesture(
		clipId: string,
		effectId: string,
		params: Readonly<Record<string, number>> = {},
	): Readonly<Record<string, number>> | null {
		if (editingBlocked()) return null;
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		if (!state.videoEffectGestures.has(key)) beginVideoEffectGesture(clipId, effectId);
		const gesture = state.videoEffectGestures.get(key)!;
		assertGestureTarget(key, gesture, effect);
		const normalized = (normalizeVideoEffect({
			...effect,
			params: { ...gesture.params, ...params },
		}) as ControllerVideoEffect).params;
		gesture.params = structuredClone(normalized);
		publishDocumentSnapshot();
		return structuredClone(normalized);
	}

	function commitVideoEffectGesture(
		clipId: string,
		effectId: string,
		params: Readonly<Record<string, number>> = {},
	): VideoEffectProject {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		const gesture = state.videoEffectGestures.get(key);
		if (gesture) assertGestureTarget(key, gesture, effect);
		const normalized = (normalizeVideoEffect({
			...effect,
			params: { ...effect.params, ...(gesture?.params || {}), ...params },
		}) as ControllerVideoEffect).params;
		state.videoEffectGestures.delete(key);
		if (effectParametersMatch(effect.params, normalized)) {
			publishDocumentSnapshot();
			const project = getProject();
			if (!project) throw new Error('Video project not found.');
			return project;
		}
		return commit({
			type: 'video-effect/update',
			clipId,
			effectId,
			changes: { params: normalized },
		}, { selectClipId: clipId });
	}

	function cancelVideoEffectGesture(clipId: string, effectId: string): boolean {
		const removed = state.videoEffectGestures.delete(videoEffectGestureKey(clipId, effectId));
		if (removed) publishDocumentSnapshot();
		return removed;
	}

	return Object.freeze({
		addVideoClipEffect,
		beginVideoEffectGesture,
		bypassVideoClipEffect,
		cancelVideoEffectGesture,
		commitVideoEffectGesture,
		previewVideoEffectGesture,
		removeVideoClipEffect,
		reorderVideoClipEffect,
		toggleVideoClipEffect,
		updateVideoClipEffect,
		videoClipEffect,
		videoEffectGestureKey,
	});
}
