import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyEditorCommand,
	createBypassVideoEffectCommand,
	createClipboardDescriptor,
	createRemoveVideoEffectCommand,
	createReorderVideoEffectCommand,
	prepareLinkedSplitCommand,
	preparePasteCommand,
	prepareRangeDeleteCommand,
} from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV4ToV5,
} from '../src/common/editor/migration.js';
import { validateAudioEditorProject } from '../src/common/editor/project.js';
import {
	createAudioEditorProjectV4,
	createVideoClipV4,
	createVideoSourceV4,
	createVideoTrackV4,
} from '../src/common/editor/project-v4.js';
import {
	createAudioEditorProjectV5,
	createVideoClipV5,
	loadAudioEditorProjectV5,
	validateAudioEditorProjectV5,
} from '../src/common/editor/project-v5.js';
import {
	VIDEO_EFFECT_DEFINITIONS,
	VIDEO_EFFECT_TYPES,
	cloneVideoEffects,
	createVideoEffect,
	normalizeVideoEffect,
	normalizeVideoEffects,
	serializeVideoEffectsToFfmpegOperations,
	updateVideoEffect,
	validateVideoEffectParams,
	videoEffectDefaults,
} from '../src/common/editor/video-effects.js';

const NOW = '2026-07-21T10:00:00.000Z';
const EDITED_AT = '2026-07-21T10:01:00.000Z';

function apply(project, command) {
	return applyEditorCommand(project, command, { now: EDITED_AT });
}

function idFactory() {
	let sequence = 0;
	return (prefix) => `${prefix}-${++sequence}`;
}

function createVideoSource() {
	return createVideoSourceV4({
		id: 'video-source',
		name: 'fixture.webm',
		mimeType: 'video/webm',
		storageKey: 'media/video-source',
		frameCount: 1_000,
		sampleRate: 48_000,
		width: 1_280,
		height: 720,
		frameRate: 30,
		videoCodec: 'vp9',
	});
}

function createV4Project() {
	const clip = createVideoClipV4({
		id: 'video-clip',
		sourceId: 'video-source',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 400,
		durationFrames: 400,
	});
	return createAudioEditorProjectV4({
		id: 'video-v4-project',
		title: 'Video V4',
		now: NOW,
		sources: [createVideoSource()],
		clips: [clip],
		tracks: [createVideoTrackV4({ id: 'video-track', clipIds: [clip.id] })],
	});
}

function createV5Project(options = {}) {
	const effects = options.effects || [createVideoEffect('pixelate', { id: 'pixelate-effect' })];
	const clip = createVideoClipV5({
		id: 'video-clip',
		sourceId: 'video-source',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 400,
		durationFrames: 400,
		videoEffects: effects,
	});
	return createAudioEditorProjectV5({
		id: 'video-v5-project',
		title: 'Video V5',
		now: NOW,
		sources: [createVideoSource()],
		clips: [clip],
		tracks: [createVideoTrackV4({ id: 'video-track', clipIds: [clip.id] })],
	});
}

test('video effect registry exposes canonical metadata, defaults, and strict normalization', () => {
	assert.deepEqual(VIDEO_EFFECT_TYPES, [
		'color-adjust',
		'pixelate',
		'vignette',
		'gaussian-blur',
		'sharpen',
		'rgb-split',
	]);
	assert.equal(VIDEO_EFFECT_DEFINITIONS.pixelate.ffmpegFilter, 'pixelize');
	assert.deepEqual(videoEffectDefaults('rgb-split'), { offsetX: 6, offsetY: 0 });
	assert.equal(validateVideoEffectParams(
		'color-adjust',
		{ brightness: 0.25 },
		'Video clip video-clip.videoEffects[0].params',
	), true);
	assert.throws(
		() => validateVideoEffectParams(
			'pixelate',
			{ blockSize: 16, expression: 'movie=secret' },
			'Video clip video-clip.videoEffects[0].params',
		),
		{
			message: 'Video clip video-clip.videoEffects[0].params.expression is not supported.',
		},
	);
	assert.throws(
		() => validateVideoEffectParams(
			'pixelate',
			{ blockSize: 2.5 },
			'Video clip video-clip.videoEffects[0].params',
		),
		{
			message: 'Video clip video-clip.videoEffects[0].params.blockSize must be an integer.',
		},
	);

	const color = createVideoEffect('color-adjust', {
		id: 'color-effect',
		params: { brightness: 0.25, hueDegrees: -45 },
	});
	assert.deepEqual(createVideoEffect('pixelate', { id: 'defaulted-pixelate' }).params, { blockSize: 16 });
	assert.deepEqual(createVideoClipV5({
		id: 'defaulted-video-clip',
		sourceId: 'video-source',
		durationFrames: 1,
		sourceDurationFrames: 1,
	}).videoEffects, []);
	assert.throws(() => createVideoClipV5({
		id: 'invalid-video-clip',
		sourceId: 'video-source',
		durationFrames: 1,
		sourceDurationFrames: 1,
		videoEffects: null,
	}), /must be an array/);
	assert.deepEqual(color, {
		id: 'color-effect',
		type: 'color-adjust',
		enabled: true,
		params: {
			brightness: 0.25,
			contrast: 1,
			saturation: 1,
			gamma: 1,
			hueDegrees: -45,
		},
	});
	assert.deepEqual(updateVideoEffect(color, { params: { contrast: 1.5 } }).params, {
		...color.params,
		contrast: 1.5,
	});
	assert.deepEqual(normalizeVideoEffect(color), color);
	assert.deepEqual(normalizeVideoEffects([color]), [color]);
	assert.throws(() => createVideoEffect('pixelate', { id: '   ' }), /non-empty string/);
	assert.throws(() => createVideoEffect('pixelate', { id: 42 }), /non-empty string/);
	assert.throws(() => createVideoEffect('pixelate', { params: { blockSize: 2.5 } }), /integer/);
	assert.throws(() => createVideoEffect('pixelate', { params: { blockSize: '16' } }), /between 2 and 128/);
	assert.throws(() => createVideoEffect('vignette', { params: { amount: true } }), /between 0 and 1/);
	assert.throws(() => createVideoEffect('sharpen', { params: { amount: null } }), /between 0 and 2/);
	assert.throws(() => createVideoEffect('sharpen', { params: null }), /must be an object/);
	assert.throws(() => createVideoEffect('gaussian-blur', { params: { sigma: Infinity } }), /between 0 and 20/);
	assert.throws(() => normalizeVideoEffect({ ...color, params: undefined }), /must be an object/);
	assert.throws(() => normalizeVideoEffect({ ...color, params: null }), /must be an object/);
	assert.throws(() => normalizeVideoEffect({ id: color.id, type: color.type, enabled: true }), /must be an object/);
	assert.throws(() => updateVideoEffect(color, { params: null }), /must be an object/);
	assert.throws(() => normalizeVideoEffect({ ...color, futureField: true }), /not supported/);
	assert.throws(() => normalizeVideoEffects([color, color]), /duplicate IDs/);

	const copies = cloneVideoEffects([color], {
		regenerateIds: true,
		idFactory: () => 'copied-effect',
	});
	assert.equal(copies[0].id, 'copied-effect');
	assert.deepEqual(copies[0].params, color.params);
	assert.notStrictEqual(copies[0].params, color.params);
});

test('video effect registry owns exact allowlisted FFmpeg serialization', () => {
	const operations = serializeVideoEffectsToFfmpegOperations([
		createVideoEffect('color-adjust', {
			id: 'color',
			params: {
				brightness: 0.25,
				contrast: 1.5,
				saturation: 0.75,
				gamma: 1.25,
				hueDegrees: -30,
			},
		}),
		createVideoEffect('pixelate', { id: 'pixel', params: { blockSize: 12 } }),
		createVideoEffect('vignette', { id: 'vignette', params: { amount: 0.5 } }),
		createVideoEffect('gaussian-blur', { id: 'blur', params: { sigma: 6 } }),
		createVideoEffect('sharpen', { id: 'sharpen', params: { amount: 1.25 } }),
		createVideoEffect('rgb-split', {
			id: 'split',
			params: { offsetX: 7, offsetY: -3 },
		}),
		createVideoEffect('pixelate', {
			id: 'bypassed',
			enabled: false,
			params: { blockSize: 99 },
		}),
	], 'clip.videoEffects');

	assert.deepEqual(operations, [
		{
			expression: 'format=pix_fmts=yuva444p,'
				+ 'eq=brightness=0.25:contrast=1.5:saturation=0.75:gamma=1.25:eval=init,'
				+ 'hue=h=-30,'
				+ 'limiter=min=16:max=235:planes=1,'
				+ 'limiter=min=16:max=240:planes=6',
			preserveAlpha: true,
		},
		{
			expression: 'pixelize=w=12:h=12:mode=avg:planes=15',
			preserveAlpha: false,
		},
		{
			expression: 'vignette=angle=0.7848981633974483:x0=w/2:y0=h/2:mode=forward:eval=init:dither=0',
			preserveAlpha: true,
		},
		{
			expression: 'gblur=sigma=6:sigmaV=6:steps=1:planes=15',
			preserveAlpha: false,
		},
		{
			expression: 'unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.25:'
				+ 'chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0',
			preserveAlpha: false,
		},
		{
			expression: 'rgbashift=rh=7:rv=-3:gh=0:gv=0:bh=-7:bv=3:ah=0:av=0:edge=smear',
			preserveAlpha: false,
		},
	]);
});

test('FFmpeg registry serialization omits no-op effects and rejects raw or malformed input', () => {
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([
		createVideoEffect('color-adjust', { id: 'neutral-color' }),
		createVideoEffect('vignette', { id: 'zero-vignette', params: { amount: 0 } }),
		createVideoEffect('gaussian-blur', { id: 'zero-blur', params: { sigma: 0 } }),
		createVideoEffect('sharpen', { id: 'zero-sharpen', params: { amount: 0 } }),
		createVideoEffect('rgb-split', {
			id: 'zero-split',
			params: { offsetX: 0, offsetY: 0 },
		}),
		createVideoEffect('pixelate', { id: 'disabled', enabled: false }),
	]), []);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([
		createVideoEffect('color-adjust', {
			id: 'hue-only',
			params: { hueDegrees: 180 },
		}),
	]), [{
		expression: 'format=pix_fmts=yuva444p,hue=h=180,'
			+ 'limiter=min=16:max=235:planes=1,'
			+ 'limiter=min=16:max=240:planes=6',
		preserveAlpha: true,
	}]);
	assert.throws(() => serializeVideoEffectsToFfmpegOperations([{
		id: 'raw',
		type: 'pixelate;movie=secret',
		enabled: true,
		params: { blockSize: 16 },
	}]), /Unsupported video effect type/);
	assert.throws(() => serializeVideoEffectsToFfmpegOperations([{
		id: 'raw-expression',
		type: 'pixelate',
		enabled: true,
		params: { blockSize: 16, expression: 'movie=secret' },
	}]), /not supported/);
	assert.throws(() => serializeVideoEffectsToFfmpegOperations([{
		id: 'malformed',
		type: 'pixelate',
		enabled: true,
		params: { blockSize: Number.NaN },
	}]), /between 2 and 128/);
});

test('V4 migrates atomically to V5 and every video clip receives an effect stack', () => {
	const v4 = createV4Project();
	const original = structuredClone(v4);
	const migrated = migrateAudioEditorProjectV4ToV5(v4);

	assert.deepEqual(v4, original);
	assert.equal(migrated.schemaVersion, 5);
	assert.deepEqual(migrated.clips[0].videoEffects, []);
	assert.equal(validateAudioEditorProjectV5(migrated), true);
	assert.equal(validateAudioEditorProject(migrated), true);
	assert.deepEqual(migrateAudioEditorProject(v4), {
		project: migrated,
		migrated: true,
		fromVersion: 4,
		readOnly: false,
		reason: null,
	});

	const future = { ...migrated, schemaVersion: 6, futureField: { retained: true } };
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future,
		migrated: false,
		fromVersion: 6,
		readOnly: true,
		reason: 'newer-schema',
	});

	const malformed = structuredClone(migrated);
	malformed.clips[0].videoEffects = [createVideoEffect('pixelate', { id: 'bad' })];
	malformed.clips[0].videoEffects[0].params.blockSize = NaN;
	assert.throws(() => validateAudioEditorProjectV5(malformed), /between 2 and 128/);
	assert.throws(() => validateAudioEditorProject(malformed), /between 2 and 128/);

	const whitespaceId = structuredClone(migrated);
	whitespaceId.clips[0].videoEffects = [{
		id: '   ',
		type: 'pixelate',
		enabled: true,
		params: { blockSize: 16 },
	}];
	assert.throws(() => validateAudioEditorProjectV5(whitespaceId), /non-empty string/);
	assert.throws(() => validateAudioEditorProject(whitespaceId), /non-empty string/);

	for (const invalidParams of [null, undefined]) {
		const invalid = structuredClone(migrated);
		invalid.clips[0].videoEffects = [{ id: 'bad-params', type: 'pixelate', enabled: true }];
		if (invalidParams !== undefined) invalid.clips[0].videoEffects[0].params = invalidParams;
		assert.throws(() => validateAudioEditorProjectV5(invalid), /params must be an object/);
		assert.throws(() => validateAudioEditorProject(invalid), /params must be an object/);
	}

	const defaultable = structuredClone(migrated);
	defaultable.clips[0].videoEffects = [{
		id: 'defaultable',
		type: 'color-adjust',
		enabled: true,
		params: { brightness: 0.25 },
	}];
	assert.equal(validateAudioEditorProjectV5(defaultable), true);
	assert.equal(validateAudioEditorProject(defaultable), true);
	assert.deepEqual(loadAudioEditorProjectV5(defaultable).project.clips[0].videoEffects[0].params, {
		brightness: 0.25,
		contrast: 1,
		saturation: 1,
		gamma: 1,
		hueDegrees: 0,
	});
});

test('canonical V5 video-effect stacks round-trip through JSON persistence', () => {
	const project = createV5Project({
		effects: [
			createVideoEffect('color-adjust', {
				id: 'round-trip-color',
				params: { brightness: -0.2, hueDegrees: 45 },
			}),
			createVideoEffect('rgb-split', {
				id: 'round-trip-rgb',
				enabled: false,
				params: { offsetX: -12, offsetY: 8 },
			}),
		],
	});
	const persisted = JSON.parse(JSON.stringify(project));
	const loaded = loadAudioEditorProjectV5(persisted);

	assert.equal(loaded.readOnly, false);
	assert.equal(loaded.reason, null);
	assert.deepEqual(loaded.project, persisted);
	assert.notStrictEqual(loaded.project.clips[0].videoEffects, persisted.clips[0].videoEffects);
	assert.notStrictEqual(loaded.project.clips[0].videoEffects[0].params, persisted.clips[0].videoEffects[0].params);
});

test('video effect commands are ordered, bypassable, strict, and undoable', () => {
	const project = createV5Project();
	assert.deepEqual(createBypassVideoEffectCommand('video-clip', 'pixelate-effect'), {
		type: 'video-effect/update',
		clipId: 'video-clip',
		effectId: 'pixelate-effect',
		changes: { enabled: false },
	});
	assert.deepEqual(createReorderVideoEffectCommand('video-clip', 'pixelate-effect', 0), {
		type: 'video-effect/reorder',
		clipId: 'video-clip',
		effectId: 'pixelate-effect',
		toIndex: 0,
	});
	assert.deepEqual(createRemoveVideoEffectCommand('video-clip', 'pixelate-effect'), {
		type: 'video-effect/remove',
		clipId: 'video-clip',
		effectId: 'pixelate-effect',
	});
	assert.throws(() => createBypassVideoEffectCommand('video-clip', 'pixelate-effect', 1), /must be boolean/);
	assert.throws(() => createReorderVideoEffectCommand('video-clip', 'pixelate-effect', -1), /non-negative/);
	let history = createEditorHistory(project);
	const color = createVideoEffect('color-adjust', { id: 'color-effect' });
	history = executeEditorCommand(history, {
		type: 'video-effect/add', clipId: 'video-clip', effect: color, index: 0,
	}, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map((effect) => effect.id), [
		'color-effect',
		'pixelate-effect',
	]);

	history = executeEditorCommand(history, {
		type: 'video-effect/update',
		clipId: 'video-clip',
		effectId: 'color-effect',
		changes: { enabled: false, params: { brightness: 0.3 } },
	}, { now: EDITED_AT });
	assert.equal(history.present.clips[0].videoEffects[0].enabled, false);
	assert.equal(history.present.clips[0].videoEffects[0].params.brightness, 0.3);

	history = executeEditorCommand(history, {
		type: 'video-effect/reorder', clipId: 'video-clip', effectId: 'color-effect', toIndex: 1,
	}, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map((effect) => effect.id), [
		'pixelate-effect',
		'color-effect',
	]);
	const beforeInvalid = structuredClone(history.present);
	assert.throws(() => apply(history.present, {
		type: 'video-effect/update',
		clipId: 'video-clip',
		effectId: 'color-effect',
		changes: { params: { brightness: 2 } },
	}), /between -1 and 1/);
	assert.deepEqual(history.present, beforeInvalid);

	history = executeEditorCommand(history, {
		type: 'video-effect/remove', clipId: 'video-clip', effectId: 'color-effect',
	}, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map((effect) => effect.id), ['pixelate-effect']);
	history = undoEditorCommand(history, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map((effect) => effect.id), [
		'pixelate-effect',
		'color-effect',
	]);
	history = redoEditorCommand(history, { now: EDITED_AT });
	assert.deepEqual(history.present.clips[0].videoEffects.map((effect) => effect.id), ['pixelate-effect']);
});

test('split, clipboard paste, and Project Bin placement copy stacks with replay-stable fresh IDs', () => {
	const project = createV5Project();
	const split = prepareLinkedSplitCommand(project, 'video-clip', 200, idFactory());
	const splitProject = apply(project, split);
	const left = splitProject.clips.find((clip) => clip.id === 'video-clip');
	const right = splitProject.clips.find((clip) => clip.id === split.rightClipId);
	assert.equal(left.videoEffects[0].id, 'pixelate-effect');
	assert.notEqual(right.videoEffects[0].id, left.videoEffects[0].id);
	assert.deepEqual(right.videoEffects[0].params, left.videoEffects[0].params);
	assert.deepEqual(apply(project, split), splitProject, 'prepared IDs make command replay deterministic');
	const rejoined = apply(splitProject, {
		type: 'clip/join',
		clipIds: [left.id, right.id],
	});
	assert.equal(rejoined.clips.length, 1);
	assert.equal(rejoined.clips[0].videoEffects[0].id, 'pixelate-effect');
	const mismatched = structuredClone(splitProject);
	mismatched.clips.find((clip) => clip.id === right.id).videoEffects[0].params.blockSize = 32;
	assert.throws(() => apply(mismatched, {
		type: 'clip/join',
		clipIds: [left.id, right.id],
	}), /different processing/);
	const rangeDelete = prepareRangeDeleteCommand(project, {
		startFrame: 100,
		endFrame: 300,
		trackIds: ['video-track'],
	}, idFactory());
	const rangeDeleted = apply(project, rangeDelete);
	assert.equal(rangeDeleted.clips.length, 2);
	assert.equal(rangeDeleted.clips.find((clip) => clip.id === 'video-clip').videoEffects[0].id, 'pixelate-effect');
	assert.notEqual(
		rangeDeleted.clips.find((clip) => clip.id !== 'video-clip').videoEffects[0].id,
		'pixelate-effect',
	);

	const clipboard = createClipboardDescriptor(project, {
		startFrame: 0,
		endFrame: 400,
		trackIds: ['video-track'],
		clipIds: ['video-clip'],
	});
	const paste = preparePasteCommand(clipboard, {
		atFrame: 500,
		mode: 'reject',
		project,
	}, idFactory());
	const pastedProject = apply(project, paste);
	const pasted = pastedProject.clips.find((clip) => clip.id === paste.clipIds['video-clip:0:400']);
	assert.ok(pasted);
	assert.notEqual(pasted.videoEffects[0].id, 'pixelate-effect');
	assert.deepEqual(pasted.videoEffects[0].params, project.clips[0].videoEffects[0].params);

	const moved = apply(project, { type: 'project-bin/move-from-timeline', clipIds: ['video-clip'] });
	const binClip = moved.projectBin.clips[0];
	assert.equal(binClip.videoEffects[0].id, 'pixelate-effect', 'moving to the Project Bin preserves IDs');
	const placed = apply(moved, {
		type: 'project-bin/place',
		binClipId: binClip.id,
		timelineStartFrame: 0,
		placements: [{
			binClipId: binClip.id,
			trackId: 'video-track',
			clipId: 'placed-video',
			videoEffectIds: ['placed-effect'],
		}],
	});
	assert.equal(placed.clips[0].videoEffects[0].id, 'placed-effect');
	assert.deepEqual(placed.clips[0].videoEffects[0].params, binClip.videoEffects[0].params);
});
