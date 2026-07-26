/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEffect,
	normalizeEffect,
	updateEffect,
} from '../effects.js';
import {
	createVideoEffect,
	normalizeVideoEffect,
	updateVideoEffect,
} from '../video-effects.js';
import {
	insertionIndex,
	requireClip,
	requireMixerBus,
	requireTrack,
} from './shared-runtime.js';

function addEffect(project, command) {
	const rack = getRack(project, command);
	const effect = command.effect?.type ? normalizeEffect(command.effect) : createEffect(command.effectType, command.effect || {});
	if (allEffects(project).some((item) => item.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	const index = command.index == null ? rack.length : insertionIndex(command.index, rack.length);
	rack.splice(index, 0, effect);
}

function updateRackEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack[index] = updateEffect(rack[index], command.changes || {});
}

function removeEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack.splice(index, 1);
}

function reorderEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= rack.length) throw new RangeError('Effect destination is out of bounds.');
	const [effect] = rack.splice(index, 1);
	rack.splice(toIndex, 0, effect);
}

function getRack(project, command) {
	if (command.scope === 'master') return project.master.effects;
	if (command.scope === 'track') {
		const track = requireTrack(project, command.trackId);
		if (track.type !== 'audio') throw new RangeError('Track effects require an audio track.');
		return track.effects;
	}
	if (command.scope === 'group' || command.scope === 'send') {
		return requireMixerBus(project, command.scope, command.busId || command.trackId).effects;
	}
	throw new RangeError('Effect scope must be track, group, send, or master.');
}

export function allEffects(project) {
	return [
		...project.master.effects,
		...project.tracks.flatMap((track) => track.effects || []),
		...(project.mixer?.groups || []).flatMap((bus) => bus.effects || []),
		...(project.mixer?.sends || []).flatMap((bus) => bus.effects || []),
	];
}

function requireVideoEffectStack(project, clipId) {
	if (project.schemaVersion < 5) throw new RangeError('Video effects require an AudioEditorProjectV5 project.');
	const clip = requireClip(project, clipId);
	if (clip.kind !== 'video') throw new RangeError(`Clip ${clipId} is not a video clip.`);
	if (!Array.isArray(clip.videoEffects)) throw new TypeError(`Video clip ${clipId} has no effect stack.`);
	return clip.videoEffects;
}

function addVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const effect = command.effect?.type
		? normalizeVideoEffect(command.effect)
		: createVideoEffect(command.effectType, command.effect || {});
	if (stack.some((candidate) => candidate.id === effect.id)) {
		throw new RangeError(`Duplicate video effect ID: ${effect.id}.`);
	}
	const index = command.index == null ? stack.length : insertionIndex(command.index, stack.length);
	stack.splice(index, 0, effect);
}

function updateClipVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	stack[index] = updateVideoEffect(stack[index], command.changes || {});
}

function removeVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	stack.splice(index, 1);
}

function reorderVideoEffect(project, command) {
	const stack = requireVideoEffectStack(project, command.clipId);
	const index = stack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown video effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= stack.length) {
		throw new RangeError('Video effect destination is out of bounds.');
	}
	const [effect] = stack.splice(index, 1);
	stack.splice(toIndex, 0, effect);
}
export function createEffectsVideoRuntimeHandlers() {
	return {
		'effect/add': addEffect,
		'effect/update': updateRackEffect,
		'effect/remove': removeEffect,
		'effect/reorder': reorderEffect,
		'video-effect/add': addVideoEffect,
		'video-effect/update': updateClipVideoEffect,
		'video-effect/remove': removeVideoEffect,
		'video-effect/reorder': reorderVideoEffect,
	};
}
