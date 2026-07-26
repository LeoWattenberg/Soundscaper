/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { EffectGestureTargetChangedError } from '../src/common/editor/controller/effect-gesture-safety.ts';
import { EditorProjectChangedError, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import {
	createVideoEffectService,
	type ControllerVideoEffect,
	type VideoEffectControllerState,
	type VideoEffectProject,
} from '../src/common/editor/controller/video-effect-service.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

function createHarness() {
	const baseEffect = createVideoEffect('pixelate', {
		id: 'video-effect-1',
		params: { blockSize: 16 },
	}) as ControllerVideoEffect;
	let project: VideoEffectProject = {
		id: 'project-a',
		clips: [{ id: 'clip-1', kind: 'video', videoEffects: [baseEffect] }],
	};
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const state: VideoEffectControllerState = {
		selectedClipId: 'clip-1',
		readOnly: false,
		videoEffectGestures: new Map(),
	};
	const commands: AudioEditorCommand[] = [];
	let publications = 0;
	let blocked = false;
	function updateClipEffects(
		clipId: string,
		update: (effects: ControllerVideoEffect[]) => ControllerVideoEffect[],
	) {
		project = {
			...project,
			clips: project.clips.map((clip) => clip.id !== clipId ? clip : {
				...clip,
				videoEffects: update([...(clip.videoEffects || [])]),
			}),
		};
	}
	const service = createVideoEffectService({
		state,
		copy: { projectReadOnly: 'Read only' },
		getProject: () => project,
		captureProject: () => generation.capture(project.id),
		assertProject: (token) => generation.assertCurrent(token),
		editingBlocked: () => blocked,
		commit: (command) => {
			commands.push(command);
			if (command.type === 'video-effect/add') {
				const effect = command.effect as unknown as ControllerVideoEffect;
				updateClipEffects(command.clipId, (effects) => {
					effects.splice(command.index ?? effects.length, 0, effect);
					return effects;
				});
			} else if (command.type === 'video-effect/update') {
				updateClipEffects(command.clipId, (effects) => effects.map((effect) => {
					if (effect.id !== command.effectId) return effect;
					return {
						...effect,
						...(typeof command.changes.enabled === 'boolean'
							? { enabled: command.changes.enabled }
							: {}),
						...(command.changes.params
							? { params: command.changes.params as Readonly<Record<string, number>> }
							: {}),
					};
				}));
			} else if (command.type === 'video-effect/reorder') {
				updateClipEffects(command.clipId, (effects) => {
					const index = effects.findIndex((effect) => effect.id === command.effectId);
					const [effect] = effects.splice(index, 1);
					if (effect) effects.splice(command.toIndex, 0, effect);
					return effects;
				});
			} else if (command.type === 'video-effect/remove') {
				updateClipEffects(command.clipId, (effects) => (
					effects.filter((effect) => effect.id !== command.effectId)
				));
			} else {
				throw new Error(`Unexpected command in video-effect test: ${command.type}.`);
			}
			return project;
		},
		publishDocumentSnapshot: () => { publications += 1; },
	});
	return {
		commands,
		generation,
		get project() { return project; },
		setProject(nextProject: VideoEffectProject, activate = false) {
			project = nextProject;
			if (activate) {
				generation.invalidate();
				generation.activate(nextProject.id);
			}
		},
		setBlocked(value: boolean) { blocked = value; },
		get publications() { return publications; },
		service,
		state,
	};
}

test('video effect stack actions validate and commit each mutation exactly once', () => {
	const harness = createHarness();
	const { service } = harness;
	assert.equal(service.addVideoClipEffect('clip-1', 'vignette', {
		id: 'video-effect-2',
		index: 0,
		params: { amount: 0.75 },
	}), 'video-effect-2');
	assert.deepEqual(harness.project.clips[0]?.videoEffects?.map((effect) => effect.id), [
		'video-effect-2',
		'video-effect-1',
	]);
	service.toggleVideoClipEffect('clip-1', 'video-effect-1');
	assert.equal(harness.project.clips[0]?.videoEffects?.[1]?.enabled, false);
	assert.throws(
		() => service.toggleVideoClipEffect('clip-1', 'video-effect-1', 'yes' as unknown as boolean),
		/must be boolean/u,
	);
	service.bypassVideoClipEffect('clip-1', 'video-effect-1', false);
	assert.equal(harness.project.clips[0]?.videoEffects?.[1]?.enabled, true);
	assert.throws(
		() => service.bypassVideoClipEffect('clip-1', 'video-effect-1', 'yes' as unknown as boolean),
		/must be boolean/u,
	);
	service.reorderVideoClipEffect('clip-1', 'video-effect-1', 0);
	assert.equal(harness.project.clips[0]?.videoEffects?.[0]?.id, 'video-effect-1');
	service.removeVideoClipEffect('clip-1', 'video-effect-2');
	assert.deepEqual(harness.project.clips[0]?.videoEffects?.map((effect) => effect.id), ['video-effect-1']);
	assert.equal(harness.commands.length, 5);
	service.commitVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 16 });
	assert.equal(harness.commands.length, 5, 'an unchanged gesture does not create history');

	harness.setBlocked(true);
	assert.equal(service.addVideoClipEffect('clip-1', 'pixelate'), null);
	assert.equal(service.updateVideoClipEffect('clip-1', 'video-effect-1', { enabled: false }), null);
	assert.equal(service.beginVideoEffectGesture('clip-1', 'video-effect-1'), null);
	assert.equal(harness.commands.length, 5);
});

test('video effect gestures preview transient params, commit once, and cancel cleanly', () => {
	const harness = createHarness();
	const { service, state } = harness;

	assert.deepEqual(service.beginVideoEffectGesture('clip-1', 'video-effect-1'), { blockSize: 16 });
	assert.deepEqual(service.previewVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 24 }), {
		blockSize: 24,
	});
	assert.deepEqual(service.previewVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 32 }), {
		blockSize: 32,
	});
	assert.equal(harness.project.clips[0]?.videoEffects?.[0]?.params.blockSize, 16);
	assert.equal(state.videoEffectGestures.get('clip-1:video-effect-1')?.params.blockSize, 32);

	service.commitVideoEffectGesture('clip-1', 'video-effect-1');
	assert.equal(harness.commands.length, 1);
	assert.equal(harness.project.clips[0]?.videoEffects?.[0]?.params.blockSize, 32);
	assert.equal(state.videoEffectGestures.size, 0);

	service.beginVideoEffectGesture('clip-1', 'video-effect-1');
	service.previewVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 64 });
	assert.equal(service.cancelVideoEffectGesture('clip-1', 'video-effect-1'), true);
	assert.equal(harness.project.clips[0]?.videoEffects?.[0]?.params.blockSize, 32);
	assert.equal(harness.commands.length, 1);
	assert.equal(harness.publications, 4);
});

test('video effect gestures reject project switches and changed targets', () => {
	const harness = createHarness();
	harness.service.beginVideoEffectGesture('clip-1', 'video-effect-1');
	harness.setProject({
		id: 'project-b',
		clips: [{
			id: 'clip-1',
			kind: 'video',
			videoEffects: [createVideoEffect('pixelate', {
				id: 'video-effect-1',
				params: { blockSize: 16 },
			}) as ControllerVideoEffect],
		}],
	}, true);
	assert.throws(
		() => harness.service.previewVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 24 }),
		EditorProjectChangedError,
	);
	assert.equal(harness.state.videoEffectGestures.size, 0);
	assert.equal(harness.commands.length, 0);

	harness.service.beginVideoEffectGesture('clip-1', 'video-effect-1');
	harness.setProject({
		...harness.project,
		clips: [{
			id: 'clip-1',
			kind: 'video',
			videoEffects: [createVideoEffect('pixelate', {
				id: 'video-effect-1',
				params: { blockSize: 48 },
			}) as ControllerVideoEffect],
		}],
	});
	assert.throws(
		() => harness.service.commitVideoEffectGesture('clip-1', 'video-effect-1', { blockSize: 64 }),
		EffectGestureTargetChangedError,
	);
	assert.equal(harness.state.videoEffectGestures.size, 0);
	assert.equal(harness.commands.length, 0);
});
