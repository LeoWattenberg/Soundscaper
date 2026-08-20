/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	createBypassVideoEffectCommand,
	createRemoveVideoEffectCommand,
	createReorderVideoEffectCommand,
	prepareLinkedSplitCommand,
} from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	VIDEO_EFFECT_DEFINITIONS,
	VIDEO_EFFECT_TYPES,
	createVideoEffect,
	normalizeVideoEffect,
	serializeVideoEffectsToFfmpegOperations,
	updateVideoEffect,
	validateVideoEffectParams,
	videoEffectDefaults,
} from '../src/common/editor/video-effects.js';

const NOW = '2026-07-21T10:00:00.000Z';
const EDITED_AT = '2026-07-21T10:01:00.000Z';
const RATE = Object.freeze({ num: 30, den: 1 });

function effectProject(effects = [createVideoEffect('pixelate', { id: 'pixelate-effect' })]) {
	const source = createVideoSource({
		id: 'video-source', name: 'fixture.webm', mimeType: 'video/webm',
		storageKey: 'video-source', sampleFrameCount: 96_000, sourceFrameCount: 60,
		frameRate: RATE, width: 1_280, height: 720, videoCodec: 'vp9',
	});
	const clip = createVideoClip({
		id: 'video-clip', sourceId: source.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 60,
		sourceInFrame: 0, sourceFrameCount: 60, videoEffects: effects,
	}, {
		projectSampleRate: 48_000,
		sequence: { id: 'main', rate: RATE },
		source,
	});
	return createCurrentAudioEditorProject({
		id: 'current-video-effects', title: 'Current video effects', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: [clip.id] })],
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
	});
}

test('video effect registry exposes canonical defaults and rejects injected parameters', () => {
	assert.equal(VIDEO_EFFECT_TYPES.length, 12);
	assert.equal(VIDEO_EFFECT_DEFINITIONS.pixelate.ffmpegFilter, 'pixelize');
	assert.deepEqual(videoEffectDefaults('rgb-split'), { offsetX: 6, offsetY: 0 });
	assert.equal(validateVideoEffectParams(
		'color-adjust', { brightness: 0.25 }, 'effect.params',
	), true);
	assert.throws(
		() => validateVideoEffectParams(
			'pixelate', { blockSize: 16, expression: 'movie=secret' }, 'effect.params',
		),
		/not supported/iu,
	);
	assert.throws(() => serializeVideoEffectsToFfmpegOperations([{
		id: 'raw-expression', type: 'pixelate', enabled: true,
		params: { blockSize: 16, expression: 'movie=secret' },
	}]), /not supported/iu);
});

test('current creation and validation own canonical video-effect stacks', () => {
	const project = effectProject([
		createVideoEffect('color-adjust', {
			id: 'color', params: { brightness: -0.2, hueDegrees: 45 },
		}),
		createVideoEffect('rgb-split', {
			id: 'rgb', enabled: false, params: { offsetX: -12, offsetY: 8 },
		}),
	]);
	assert.equal(validateCurrentAudioEditorProject(project), true);
	const persisted = JSON.parse(JSON.stringify(project));
	const loaded = createCurrentAudioEditorProject({ ...persisted, now: persisted.createdAt });
	assert.deepEqual(loaded, persisted);
	assert.notStrictEqual(loaded.clips[0].videoEffects, persisted.clips[0].videoEffects);

	const malformed = structuredClone(project);
	malformed.clips[0].videoEffects[0].params.brightness = Number.NaN;
	assert.throws(
		() => validateCurrentAudioEditorProject(malformed),
		/JSON-serializable|between -1 and 1/iu,
	);
	assert.deepEqual(normalizeVideoEffect({
		id: 'defaultable', type: 'color-adjust', enabled: true,
		params: { brightness: 0.25 },
	}), {
		id: 'defaultable', type: 'color-adjust', enabled: true,
		params: { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	});
});

test('current video effect commands are ordered, strict, and undoable', () => {
	const project = effectProject();
	assert.deepEqual(createBypassVideoEffectCommand('video-clip', 'pixelate-effect'), {
		type: 'video-effect/update', clipId: 'video-clip', effectId: 'pixelate-effect',
		changes: { enabled: false },
	});
	assert.deepEqual(createReorderVideoEffectCommand('video-clip', 'pixelate-effect', 0), {
		type: 'video-effect/reorder', clipId: 'video-clip', effectId: 'pixelate-effect', toIndex: 0,
	});
	assert.deepEqual(createRemoveVideoEffectCommand('video-clip', 'pixelate-effect'), {
		type: 'video-effect/remove', clipId: 'video-clip', effectId: 'pixelate-effect',
	});

	let history = createEditorHistory(project);
	history = executeEditorCommand(history, {
		type: 'video-effect/add', clipId: 'video-clip', index: 0,
		effect: createVideoEffect('color-adjust', { id: 'color-effect' }),
	}, { now: EDITED_AT });
	history = executeEditorCommand(history, {
		type: 'video-effect/update', clipId: 'video-clip', effectId: 'color-effect',
		changes: { enabled: false, params: { brightness: 0.3 } },
	}, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map(({ id }) => id), [
		'color-effect', 'pixelate-effect',
	]);
	assert.deepEqual(updateVideoEffect(history.present.clips[0].videoEffects[0], {
		params: { contrast: 1.2 },
	}).params, {
		brightness: 0.3, contrast: 1.2, saturation: 1, gamma: 1, hueDegrees: 0,
	});

	history = executeEditorCommand(history, createRemoveVideoEffectCommand(
		'video-clip', 'color-effect',
	), { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map(({ id }) => id), ['pixelate-effect']);
	history = undoEditorCommand(history, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map(({ id }) => id), [
		'color-effect', 'pixelate-effect',
	]);
	history = redoEditorCommand(history, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map(({ id }) => id), ['pixelate-effect']);
});

test('current video splits copy effect state under fresh identities', () => {
	const project = effectProject();
	const runtime = projectForCommand(project);
	let nextId = 0;
	const command = prepareLinkedSplitCommand(runtime, 'video-clip', 48_000, (prefix) => (
		`${prefix}-${String(nextId++)}`
	));
	const edited = applyEditorCommand(project, command, { now: EDITED_AT });
	assert.equal(edited.clips.length, 2);
	assert.equal(edited.clips[0].videoEffects[0].id, 'pixelate-effect');
	assert.notEqual(edited.clips[1].videoEffects[0].id, 'pixelate-effect');
	assert.deepEqual(edited.clips[1].videoEffects[0].params, edited.clips[0].videoEffects[0].params);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
});

test('video effect commands reject retired V5 wire', () => {
	assert.throws(() => applyEditorCommand({ schemaVersion: 5 }, {
		type: 'video-effect/remove', clipId: 'clip', effectId: 'effect',
	}, { now: EDITED_AT }), /current audio editor project/iu);
});
