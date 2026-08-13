/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetVideoKeyframesCommand } from '../src/common/editor/commands.js';
import { createVideoKeyframesRuntimeHandlers } from '../src/common/editor/commands/video-keyframes-runtime.ts';
import {
	snapshotVideoKeyframesSetCommand,
} from '../src/common/editor/commands/video-keyframes.ts';
import {
	createDefaultVideoKeyframeCurves,
} from '../src/common/editor/video-keyframe-curves.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../src/common/editor/video-clip-composition.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

type DataRecord = Record<string, unknown>;

test('the context-free command snapshot is closed, detached, and deeply frozen', () => {
	const expected = structuredClone(emptyKeyframes());
	const next = opacityKeyframes();
	const command = createSetVideoKeyframesCommand('video', expected, next);

	assert.deepEqual(command, {
		type: 'video-keyframes/set', clipId: 'video',
		expectedKeyframes: emptyKeyframes(), keyframes: opacityKeyframes(),
	});
	assert.notStrictEqual(command.expectedKeyframes, expected);
	assert.notStrictEqual(command.keyframes, next);
	assert.equal(Object.isFrozen(command), true);
	assert.equal(Object.isFrozen(command.keyframes.timeDomain), true);
	assert.equal(Object.isFrozen(command.keyframes.curves), true);
	const entry = command.keyframes.curves[0] as Readonly<{
		curve: Readonly<{ anchors: readonly unknown[] }>;
		target: Readonly<{ kind: string }>;
	}> | undefined;
	assert.equal(Object.isFrozen(entry?.curve.anchors), true);

	(next.curves as DataRecord[])[0] = { replacement: true };
	assert.equal(entry?.target.kind, 'composition');
	assert.throws(
		() => snapshotVideoKeyframesSetCommand({ ...command, future: true }),
		/unsupported field/iu,
	);
	assert.throws(
		() => snapshotVideoKeyframesSetCommand({ ...command, type: 'video-keyframes/reset' }),
		/type.*video-keyframes\/set/iu,
	);
	assert.throws(
		() => snapshotVideoKeyframesSetCommand({
			...command, keyframes: { ...command.keyframes, schemaVersion: 2 },
		}),
		/keyframes\.schemaVersion.*1/iu,
	);
	assert.throws(
		() => createSetVideoKeyframesCommand(' ', expected, next),
		/video clip ID.*non-empty/iu,
	);
});

test('the command budgets each valid optimistic wire without double-counting both copies', () => {
	const anchors = Array.from({ length: 4_096 }, (_, index) => ({
		position: { num: index, den: 1 }, value: index % 2 ? 0.75 : 0.25,
	}));
	const segments = Array.from({ length: anchors.length - 1 }, () => ({ kind: 'linear' }));
	const wire = {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: 4_095, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: 4_095, den: 1 },
		},
		curves: ['opacity', 'transform.positionX'].map((parameterId) => ({
			target: { kind: 'composition', parameterId },
			curve: { anchors, segments },
		})),
	};
	const command = createSetVideoKeyframesCommand('video', wire, wire);
	assert.equal(command.expectedKeyframes.curves.length, 2);
	assert.equal(command.keyframes.curves.length, 2);
	assert.notStrictEqual(command.expectedKeyframes, command.keyframes);
});

test('the command snapshot rejects accessors, cycles, and disguised arrays without invoking code', () => {
	let reads = 0;
	const command = {
		type: 'video-keyframes/set', clipId: 'video',
		expectedKeyframes: emptyKeyframes(), keyframes: opacityKeyframes(),
	} as DataRecord;
	Object.defineProperty(command, 'keyframes', {
		enumerable: true,
		get() { reads += 1; return opacityKeyframes(); },
	});
	assert.throws(() => snapshotVideoKeyframesSetCommand(command), /keyframes.*data property/iu);
	assert.equal(reads, 0);

	const nested = opacityKeyframes();
	Object.defineProperty(nested.timeDomain as object, 'viewStart', {
		enumerable: true,
		get() { reads += 1; return { num: 0, den: 1 }; },
	});
	assert.throws(
		() => createSetVideoKeyframesCommand('video', emptyKeyframes(), nested),
		/accessor|data propert/iu,
	);
	assert.equal(reads, 0);

	const namedArray = opacityKeyframes();
	Object.defineProperty(namedArray.curves as object, 'hidden', { enumerable: true, value: true });
	assert.throws(
		() => createSetVideoKeyframesCommand('video', emptyKeyframes(), namedArray),
		/array.*named|array.*properties/iu,
	);

	const cyclic = opacityKeyframes() as DataRecord;
	(cyclic.timeDomain as DataRecord).cycle = cyclic;
	assert.throws(
		() => createSetVideoKeyframesCommand('video', emptyKeyframes(), cyclic),
		/cyclic/iu,
	);

	const binary = opacityKeyframes();
	(binary.timeDomain as DataRecord).viewStart = new Uint8Array([0]);
	assert.throws(
		() => createSetVideoKeyframesCommand('video', emptyKeyframes(), binary),
		/JSON-safe/iu,
	);
	const negativeZero = opacityKeyframes();
	((negativeZero.curves as DataRecord[])[0]!.curve as DataRecord).anchors = [
		{ position: { num: -0, den: 1 }, value: 0.25 },
		{ position: { num: 10, den: 1 }, value: 0.75 },
	];
	assert.throws(
		() => createSetVideoKeyframesCommand('video', emptyKeyframes(), negativeZero),
		/negative zero/iu,
	);
});

test('the runtime replaces timeline and Project Bin values against live clip context', () => {
	const project = projectFixture();
	const handlers = createVideoKeyframesRuntimeHandlers();
	const timelineNext = opacityKeyframes();
	handlers['video-keyframes/set'](project, createSetVideoKeyframesCommand(
		'video', emptyKeyframes(), timelineNext,
	));
	const timeline = (project.clips as DataRecord[])[0]!;
	assert.deepEqual(timeline.videoKeyframes, opacityKeyframes());
	assert.notStrictEqual(timeline.videoKeyframes, timelineNext);
	assert.equal(Object.isFrozen(timeline.videoKeyframes), true);

	const binNext = effectKeyframes();
	handlers['video-keyframes/set'](project, createSetVideoKeyframesCommand(
		'bin-video', emptyKeyframes(), binNext,
	));
	const projectBin = project.projectBin as DataRecord;
	const bin = (projectBin.clips as DataRecord[])[0]!;
	assert.deepEqual(bin.videoKeyframes, effectKeyframes());
	assert.notStrictEqual(bin.videoKeyframes, binNext);
	assert.deepEqual(timeline.videoKeyframes, opacityKeyframes());
});

test('the runtime rejects stale, invalid, or unsupported targets before assignment', () => {
	const handlers = createVideoKeyframesRuntimeHandlers();
	for (const [name, expected, next, message] of [
		['stale', opacityKeyframes(), opacityKeyframes(0.1, 0.9), /changed before.*committed/iu],
		['missing effect', emptyKeyframes(), effectKeyframes('missing'), /missing video effect/iu],
		['discrete composition', emptyKeyframes(), compositionTargetKeyframes('compositingOrder'), /not an interpolable/iu],
		['flip composition', emptyKeyframes(), compositionTargetKeyframes('transform.flipHorizontal'), /not an interpolable/iu],
		['blend composition', emptyKeyframes(), compositionTargetKeyframes('blendMode'), /not an interpolable/iu],
	] as const) {
		const project = projectFixture();
		const clip = (project.clips as DataRecord[])[0]!;
		const before = clip.videoKeyframes;
		assert.throws(
			() => handlers['video-keyframes/set'](project, createSetVideoKeyframesCommand(
				'video', expected, next,
			)),
			message,
			name,
		);
		assert.strictEqual(clip.videoKeyframes, before, name);
	}
});

test('the runtime fails closed for missing, duplicate, and audio clip identities', () => {
	const handlers = createVideoKeyframesRuntimeHandlers();
	const command = (clipId: string) => createSetVideoKeyframesCommand(
		clipId, emptyKeyframes(), opacityKeyframes(),
	);
	assert.throws(
		() => handlers['video-keyframes/set'](projectFixture(), command('missing')),
		/missing/iu,
	);
	assert.throws(
		() => handlers['video-keyframes/set'](projectFixture(), command('audio')),
		/not a video clip/iu,
	);
	const duplicate = projectFixture();
	const projectBin = duplicate.projectBin as DataRecord;
	(projectBin.clips as DataRecord[])[0]!.id = 'video';
	assert.throws(
		() => handlers['video-keyframes/set'](duplicate, command('video')),
		/not globally unique/iu,
	);
});

test('the runtime inspects clip collections and identities without invoking accessors', () => {
	const handlers = createVideoKeyframesRuntimeHandlers();
	const project = projectFixture();
	let reads = 0;
	Object.defineProperty((project.clips as DataRecord[])[0], 'id', {
		enumerable: true,
		get() { reads += 1; return 'video'; },
	});
	assert.throws(
		() => handlers['video-keyframes/set'](project, createSetVideoKeyframesCommand(
			'video', emptyKeyframes(), opacityKeyframes(),
		)),
		/id.*data property/iu,
	);
	assert.equal(reads, 0);

	const hostileContext = projectFixture();
	const effect = (((hostileContext.clips as DataRecord[])[0]!.videoEffects as DataRecord[])[0]!);
	Object.defineProperty(effect, 'params', {
		enumerable: true,
		get() { reads += 1; return {}; },
	});
	assert.throws(
		() => handlers['video-keyframes/set'](hostileContext, createSetVideoKeyframesCommand(
			'video', emptyKeyframes(), opacityKeyframes(),
		)),
		/accessor|data propert/iu,
	);
	assert.equal(reads, 0);

	const disguised = projectFixture();
	Object.defineProperty(disguised.clips as object, 'extra', { enumerable: true, value: true });
	assert.throws(
		() => handlers['video-keyframes/set'](disguised, createSetVideoKeyframesCommand(
			'video', emptyKeyframes(), opacityKeyframes(),
		)),
		/unsupported field/iu,
	);
});

function projectFixture(): DataRecord {
	return {
		clips: [videoClip('video'), { id: 'audio', kind: 'audio' }],
		projectBin: { clips: [videoClip('bin-video')] },
	};
}

function videoClip(id: string): DataRecord {
	return {
		id,
		kind: 'video',
		sequenceFrameCount: 10,
		videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		videoEffects: [createVideoEffect('color-adjust', { id: 'grade' })],
		videoKeyframes: emptyKeyframes(),
	};
}

function emptyKeyframes(): ReturnType<typeof createDefaultVideoKeyframeCurves> {
	return createDefaultVideoKeyframeCurves({ num: 10, den: 1 });
}

function opacityKeyframes(start = 0.25, end = 0.75): DataRecord {
	return curveWire({ kind: 'composition', parameterId: 'opacity' }, start, end);
}

function effectKeyframes(effectId = 'grade'): DataRecord {
	return curveWire({ kind: 'video-effect', effectId, parameterId: 'brightness' }, -0.25, 0.25);
}

function compositionTargetKeyframes(parameterId: string): DataRecord {
	return curveWire({ kind: 'composition', parameterId }, 0, 1);
}

function curveWire(target: DataRecord, start: number, end: number): DataRecord {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: 10, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: 10, den: 1 },
		},
		curves: [{
			target,
			curve: {
				anchors: [
					{ position: { num: 0, den: 1 }, value: start },
					{ position: { num: 10, den: 1 }, value: end },
				],
				segments: [{ kind: 'linear' }],
			},
		}],
	};
}
