/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareLinkedSplitCommand,
} from '../src/common/editor/commands.js';
import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import {
	normalizeAudioEditorClipboardDescriptor,
} from '../src/common/editor/commands/clipboard-codec.ts';
import {
	createAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../src/common/editor/video-clip-composition.ts';
import {
	createVideoEffect,
} from '../src/common/editor/video-effects.js';

const NOW = '2026-08-13T21:00:00.000Z';
const FRAME_SAMPLES = 4_800;

test('split partitions exact views, detaches complete paths, remaps effect targets, and rejoins', () => {
	const base = projectFixture();
	const command = prepareLinkedSplitCommand(
		base as never,
		'video-clip',
		5 * FRAME_SAMPLES,
		stableIds(),
	);
	const split = apply(base, command);
	const left = timelineClip(split, 'video-clip');
	const rightId = String(command.rightClipId);
	const right = timelineClip(split, rightId);

	assert.deepEqual(domain(left), domainValue(10, 0, 5));
	assert.deepEqual(domain(right), domainValue(10, 5, 5));
	assert.deepEqual(curvePath(left), curvePath(right));
	assert.notStrictEqual(keyframes(left), keyframes(right));
	assert.notStrictEqual(curvePath(left), curvePath(right));
	assert.equal(effectTarget(left), 'effect-original');
	assert.equal(effectTarget(right), firstEffectId(right));
	assert.notEqual(effectTarget(right), effectTarget(left));

	const joined = apply(split, {
		type: 'clip/join', clipIds: ['video-clip', rightId],
	});
	const result = timelineClip(joined, 'video-clip');
	assert.deepEqual(domain(result), domainValue(10, 0, 10));
	assert.deepEqual(curvePath(result), curvePath(left));
	assert.notStrictEqual(keyframes(result), keyframes(left));
	assert.equal(effectTarget(result), 'effect-original');
});

test('trim and extension preserve authored paths while changing only their exact view authority', () => {
	const base = projectFixture({ sequenceStartFrame: 5, sourceInFrame: 5 });
	const trimmed = apply(base, {
		type: 'clip/trim', clipId: 'video-clip',
		timelineStartFrame: 7 * FRAME_SAMPLES,
		durationFrames: 6 * FRAME_SAMPLES,
		sourceStartFrame: 7,
		sourceDurationFrames: 6,
	});
	assert.deepEqual(domain(timelineClip(trimmed, 'video-clip')), domainValue(10, 2, 6));
	assert.deepEqual(curvePath(timelineClip(trimmed, 'video-clip')), curvePath(timelineClip(base, 'video-clip')));

	const extended = apply(base, {
		type: 'clip/trim', clipId: 'video-clip',
		timelineStartFrame: 3 * FRAME_SAMPLES,
		durationFrames: 14 * FRAME_SAMPLES,
		sourceStartFrame: 3,
		sourceDurationFrames: 14,
	});
	const extendedClip = timelineClip(extended, 'video-clip');
	assert.deepEqual(domain(extendedClip), domainValue(14, 0, 14));
	assert.deepEqual(
		curvePath(extendedClip).anchors.map(({ position }) => position),
		[{ num: 2, den: 1 }, { num: 12, den: 1 }],
	);

	const equalLength = apply(projectFixture(), {
		type: 'clip/trim', clipId: 'video-clip',
		timelineStartFrame: 2 * FRAME_SAMPLES,
		durationFrames: 10 * FRAME_SAMPLES,
		sourceStartFrame: 2,
		sourceDurationFrames: 10,
	});
	assert.deepEqual(domain(timelineClip(equalLength, 'video-clip')), domainValue(12, 2, 10));
});

test('stretch, move, slip, source replacement, and reprobe retain byte-equivalent authored authority', () => {
	const base = projectFixture();
	const original = keyframes(timelineClip(base, 'video-clip'));
	const stretched = apply(base, {
		type: 'clip/transform-many', overwrite: false, transforms: [{
			clipId: 'video-clip', trackId: 'video-track',
			changes: { durationFrames: 20 * FRAME_SAMPLES },
			sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 20 },
		}],
	});
	assert.deepEqual(keyframes(timelineClip(stretched, 'video-clip')), original);

	const moved = apply(base, {
		type: 'clip/move', clipId: 'video-clip', timelineStartFrame: 10 * FRAME_SAMPLES,
	});
	assert.deepEqual(keyframes(timelineClip(moved, 'video-clip')), original);

	const slipped = apply(base, {
		type: 'clip/transform-many', overwrite: false, transforms: [{
			clipId: 'video-clip', trackId: 'video-track',
			changes: { sourceStartFrame: 1, sourceDurationFrames: 10 },
		}],
	});
	assert.deepEqual(keyframes(timelineClip(slipped, 'video-clip')), original);

	const replaced = apply(base, {
		type: 'clip/replace-source', clipId: 'video-clip', sourceId: 'video-source-b',
	});
	assert.deepEqual(keyframes(timelineClip(replaced, 'video-clip')), original);
	const reprobed = apply(replaced, {
		type: 'source/reprobe', sourceId: 'video-source-b',
		changes: { width: 1_280, height: 720 },
		clips: [{ clipId: 'video-clip', sourceInFrame: 0, sourceFrameCount: 10 }],
	});
	assert.deepEqual(keyframes(timelineClip(reprobed, 'video-clip')), original);
});

test('overwrite derives trim and extension views from source-local intent across relocation', () => {
	const base = projectFixture();
	const trimChanges = {
		durationFrames: 6 * FRAME_SAMPLES,
		sourceStartFrame: 2,
		sourceDurationFrames: 6,
	};
	const inPlaceTrim = apply(base, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { ...trimChanges, timelineStartFrame: 2 * FRAME_SAMPLES },
	});
	const relocatedTrim = apply(base, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { ...trimChanges, timelineStartFrame: 12 * FRAME_SAMPLES },
	});
	assert.deepEqual(keyframes(timelineClip(relocatedTrim, 'video-clip')), keyframes(timelineClip(inPlaceTrim, 'video-clip')));
	assert.deepEqual(domain(timelineClip(relocatedTrim, 'video-clip')), domainValue(10, 2, 6));

	const inset = projectFixture({ sequenceStartFrame: 5, sourceInFrame: 5 });
	const extensionChanges = {
		durationFrames: 14 * FRAME_SAMPLES,
		sourceStartFrame: 3,
		sourceDurationFrames: 14,
	};
	const inPlaceExtension = apply(inset, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { ...extensionChanges, timelineStartFrame: 3 * FRAME_SAMPLES },
	});
	const relocatedExtension = apply(inset, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { ...extensionChanges, timelineStartFrame: 20 * FRAME_SAMPLES },
	});
	assert.deepEqual(
		keyframes(timelineClip(relocatedExtension, 'video-clip')),
		keyframes(timelineClip(inPlaceExtension, 'video-clip')),
	);
	assert.deepEqual(domain(timelineClip(relocatedExtension, 'video-clip')), domainValue(14, 0, 14));

	const moved = apply(base, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { timelineStartFrame: 10 * FRAME_SAMPLES },
	});
	const slipped = apply(base, {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: { sourceStartFrame: 1, sourceDurationFrames: 10 },
	});
	assert.deepEqual(keyframes(timelineClip(moved, 'video-clip')), keyframes(timelineClip(base, 'video-clip')));
	assert.deepEqual(keyframes(timelineClip(slipped, 'video-clip')), keyframes(timelineClip(base, 'video-clip')));
});

test('Project Bin move and placement detach keyframes and remap regenerated effect identities', () => {
	const base = projectFixture();
	const commandProject = projectForCommandConsumers(base as never) as unknown as AudioEditorProjectV17;
	const addValue = { ...timelineClip(commandProject, 'video-clip'), id: 'added-bin', binItemId: 'added-bin' };
	const added = apply(base, { type: 'project-bin/add', clip: addValue });
	assert.deepEqual(keyframes(binClip(added, 'added-bin')), keyframes(timelineClip(base, 'video-clip')));
	const updated = apply(added, {
		type: 'project-bin/update', clipId: 'added-bin', changes: { title: 'Updated bin video' },
	});
	assert.deepEqual(keyframes(binClip(updated, 'added-bin')), keyframes(binClip(added, 'added-bin')));
	assert.notStrictEqual(keyframes(binClip(updated, 'added-bin')), keyframes(binClip(added, 'added-bin')));

	const moved = apply(base, {
		type: 'project-bin/move-from-timeline', clipIds: ['video-clip'],
	});
	const binned = binClip(moved, 'video-clip');
	assert.deepEqual(keyframes(binned), keyframes(timelineClip(base, 'video-clip')));
	assert.notStrictEqual(keyframes(binned), keyframes(timelineClip(base, 'video-clip')));

	const placed = apply(moved, {
		type: 'project-bin/place', binClipId: 'video-clip', timelineStartFrame: 0,
		placements: [{
			binClipId: 'video-clip', trackId: 'video-track', clipId: 'placed-video',
			videoEffectIds: ['placed-effect'],
		}],
	});
	const result = timelineClip(placed, 'placed-video');
	assert.deepEqual(domain(result), domainValue(10, 0, 10));
	assert.equal(effectTarget(result), 'placed-effect');
	assert.notStrictEqual(keyframes(result), keyframes(binned));

	const replacementProject = projectForCommandConsumers(moved as never) as unknown as AudioEditorProjectV17;
	const template = {
		...binClip(replacementProject, 'video-clip'),
		id: 'replacement-template', sourceId: 'video-source-b', binItemId: 'replacement-template',
	};
	const replaced = apply(moved, {
		type: 'project-bin/replace-media', clipId: 'video-clip',
		replacements: [{ oldSourceId: 'video-source-a', newSourceId: 'video-source-b' }],
		templates: [template], shortfallMode: 'keep-spacing',
	});
	assert.equal(binClip(replaced, 'video-clip').sourceId, 'video-source-b');
	assert.deepEqual(keyframes(binClip(replaced, 'video-clip')), keyframes(binned));
	assert.notStrictEqual(keyframes(binClip(replaced, 'video-clip')), keyframes(binned));
});

test('clipboard V6 carries bounded keyframes, trims copied views, and remaps pasted effects', () => {
	const base = projectFixture();
	const commandProject = projectForCommandConsumers(base as never);
	const descriptor = createClipboardDescriptor(commandProject, {
		startFrame: 2 * FRAME_SAMPLES,
		endFrame: 8 * FRAME_SAMPLES,
		trackIds: ['video-track'],
		clipIds: ['video-clip'],
	});
	assert.equal(descriptor.schemaVersion, 6);
	const copied = descriptor.tracks[0]?.clips[0] as Record<string, unknown>;
	assert.deepEqual(domain(copied), domainValue(10, 2, 6));
	assert.notStrictEqual(keyframes(copied), keyframes(timelineClip(base, 'video-clip')));

	const command = preparePasteCommand(descriptor, {
		atFrame: 10 * FRAME_SAMPLES, mode: 'reject', project: commandProject,
	}, stableIds());
	const pasted = apply(base, command);
	const pastedId = Object.values(command.clipIds)[0];
	assert.ok(pastedId);
	const result = timelineClip(pasted, pastedId);
	assert.deepEqual(domain(result), domainValue(10, 2, 6));
	assert.equal(effectTarget(result), firstEffectId(result));
	assert.notEqual(effectTarget(result), effectTarget(copied));
	assert.notStrictEqual(keyframes(result), keyframes(copied));

	const mislabeled = structuredClone(descriptor) as unknown as Record<string, unknown>;
	mislabeled.schemaVersion = 5;
	assert.throws(
		() => normalizeAudioEditorClipboardDescriptor(mislabeled),
		/V6 recopy|videoKeyframes/iu,
	);
	const missing = structuredClone(descriptor) as unknown as Record<string, unknown>;
	delete (((missing.tracks as Array<{ clips: Record<string, unknown>[] }>)[0]!).clips[0]!).videoKeyframes;
	assert.doesNotThrow(() => normalizeAudioEditorClipboardDescriptor(missing));
});

test('join refuses unequal complete paths without mutating either input', () => {
	const command = prepareLinkedSplitCommand(
		projectFixture() as never,
		'video-clip',
		5 * FRAME_SAMPLES,
		stableIds(),
	);
	const split = apply(projectFixture(), command);
	const changed = structuredClone(split) as AudioEditorProjectV17;
	const right = timelineClip(changed, String(command.rightClipId));
	const rightKeyframes = right.videoKeyframes as {
		curves: Array<{ curve: { anchors: Array<{ value: number }> } }>;
	};
	rightKeyframes.curves[0]!.curve.anchors[0]!.value = 0.5;
	const before = structuredClone(changed);
	assert.throws(
		() => apply(changed, {
			type: 'clip/join', clipIds: ['video-clip', String(command.rightClipId)],
		}),
		/keyframe|processing|authored path/iu,
	);
	assert.deepEqual(changed, before);
});

test('post-reconcile trimming never erases a direct keyframe command', () => {
	const base = projectFixture();
	const expected = keyframes(timelineClip(base, 'video-clip'));
	const next = structuredClone(expected);
	((next.curves as Array<{ curve: { anchors: Array<{ value: number }> } }>)[0]!).curve.anchors[0]!.value = 0.5;
	const result = apply(base, {
		type: 'video-keyframes/set', clipId: 'video-clip',
		expectedKeyframes: expected, keyframes: next,
	});
	assert.deepEqual(keyframes(timelineClip(result, 'video-clip')), next);
});

test('post-reconcile carrier comparison never invokes a hostile toJSON hook', () => {
	const base = projectFixture();
	let calls = 0;
	const hostile = base as unknown as { clips: Array<{ videoKeyframes: Record<string, unknown> }> };
	Object.defineProperty(hostile.clips[0]!.videoKeyframes, 'toJSON', {
		enumerable: false,
		value() { calls += 1; return {}; },
	});
	assert.throws(
		() => apply(base, { type: 'clip/move', clipId: 'video-clip', timelineStartFrame: FRAME_SAMPLES }),
		/toJSON|unsupported field/iu,
	);
	assert.equal(calls, 0);
});

test('same-clip batches apply explicit keyframe sets and exact trims in command order', () => {
	const base = projectFixture();
	const expected = keyframes(timelineClip(base, 'video-clip'));
	const next = structuredClone(expected);
	((next.curves as Array<{ curve: { anchors: Array<{ value: number }> } }>)[0]!).curve.anchors[0]!.value = 0.5;
	const trim = {
		type: 'clip/trim', clipId: 'video-clip', timelineStartFrame: 2 * FRAME_SAMPLES,
		durationFrames: 10 * FRAME_SAMPLES, sourceStartFrame: 2, sourceDurationFrames: 10,
	};
	const set = {
		type: 'video-keyframes/set', clipId: 'video-clip', expectedKeyframes: expected, keyframes: next,
	};
	const setThenTrim = apply(base, { type: 'batch', commands: [set, trim] });
	assert.deepEqual(domain(timelineClip(setThenTrim, 'video-clip')), domainValue(12, 2, 10));
	assert.equal(firstCurveValue(timelineClip(setThenTrim, 'video-clip')), 0.5);

	const trimmed = apply(base, trim);
	const trimThenSet = apply(base, {
		type: 'batch', commands: [trim, {
			...set, expectedKeyframes: keyframes(timelineClip(trimmed, 'video-clip')),
		}],
	});
	assert.deepEqual(keyframes(timelineClip(trimThenSet, 'video-clip')), next);

	const canonicalTrim = {
		type: 'clip/transform-many', overwrite: false, transforms: [{
			clipId: 'video-clip', trackId: 'video-track',
			changes: {
				timelineStartFrame: 2 * FRAME_SAMPLES,
				durationFrames: 6 * FRAME_SAMPLES,
				sourceStartFrame: 2,
				sourceDurationFrames: 6,
			},
			sequencePlacement: { sequenceStartFrame: 2, sequenceFrameCount: 6 },
		}],
	};
	const setThenCanonicalTrim = apply(base, {
		type: 'batch', commands: [set, canonicalTrim],
	});
	assert.deepEqual(domain(timelineClip(setThenCanonicalTrim, 'video-clip')), domainValue(10, 2, 6));
	assert.equal(firstCurveValue(timelineClip(setThenCanonicalTrim, 'video-clip')), 0.5);

	const canonicalTrimmed = apply(base, canonicalTrim);
	const canonicalTrimThenSet = apply(base, {
		type: 'batch', commands: [canonicalTrim, {
			...set, expectedKeyframes: keyframes(timelineClip(canonicalTrimmed, 'video-clip')),
		}],
	});
	assert.deepEqual(keyframes(timelineClip(canonicalTrimThenSet, 'video-clip')), next);

	const overwriteTrim = {
		type: 'clip/overwrite', clipId: 'video-clip', trackId: 'video-track',
		changes: {
			timelineStartFrame: 2 * FRAME_SAMPLES,
			durationFrames: 6 * FRAME_SAMPLES,
			sourceStartFrame: 2,
			sourceDurationFrames: 6,
		},
	};
	const setThenOverwriteTrim = apply(base, {
		type: 'batch', commands: [set, overwriteTrim],
	});
	assert.deepEqual(domain(timelineClip(setThenOverwriteTrim, 'video-clip')), domainValue(10, 2, 6));
	assert.equal(firstCurveValue(timelineClip(setThenOverwriteTrim, 'video-clip')), 0.5);

	const overwriteTrimmed = apply(base, overwriteTrim);
	const overwriteTrimThenSet = apply(base, {
		type: 'batch', commands: [overwriteTrim, {
			...set, expectedKeyframes: keyframes(timelineClip(overwriteTrimmed, 'video-clip')),
		}],
	});
	assert.deepEqual(keyframes(timelineClip(overwriteTrimThenSet, 'video-clip')), next);
});

function projectFixture(overrides: Readonly<{
	sequenceStartFrame?: number;
	sourceInFrame?: number;
}> = {}): AudioEditorProjectV17 {
	const effect = createVideoEffect('color-adjust', { id: 'effect-original' });
	const sequenceStartFrame = overrides.sequenceStartFrame ?? 0;
	const sourceInFrame = overrides.sourceInFrame ?? 0;
	return createAudioEditorProjectV17({
		id: 'keyframe-edit-preservation', title: 'Keyframe edit preservation', now: NOW,
		sources: [
			videoSource('video-source-a', '12'),
			videoSource('video-source-b', '34'),
		],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source-a', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame, sequenceFrameCount: 10,
			sourceInFrame, sourceFrameCount: 10, retimeMap: null,
			videoEffects: [effect], videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoKeyframes: authoredKeyframes(),
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
		})],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'],
		}],
		primarySequenceId: 'main-sequence',
	});
}

function authoredKeyframes(): Record<string, unknown> {
	const path = {
		anchors: [
			{ position: { num: 0, den: 1 }, value: 0.25 },
			{ position: { num: 10, den: 1 }, value: 0.75 },
		],
		segments: [{ kind: 'bezier',
			control1: { position: { num: 3, den: 1 }, value: 0.4 },
			control2: { position: { num: 7, den: 1 }, value: 0.6 },
		}],
	};
	return {
		schemaVersion: 1,
		timeDomain: domainValue(10, 0, 10),
		curves: [
			{ target: { kind: 'composition', parameterId: 'opacity' }, curve: path },
			{
				target: { kind: 'video-effect', effectId: 'effect-original', parameterId: 'brightness' },
				curve: structuredClone(path),
			},
		],
	};
}

function videoSource(id: string, digest: string): Record<string, unknown> {
	return createVideoSourceV10({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256: digest.repeat(32),
		sampleFrameCount: 20 * FRAME_SAMPLES, sourceFrameCount: 20,
		frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
	});
}

function apply(project: AudioEditorProjectV17, command: unknown): AudioEditorProjectV17 {
	return applyEditorCommand(project, command as never, { now: NOW });
}

function timelineClip(project: AudioEditorProjectV17, id: string): Record<string, unknown> {
	const result = project.clips.find((clip) => clip.id === id);
	assert.ok(result);
	return result as Record<string, unknown>;
}

function binClip(project: AudioEditorProjectV17, id: string): Record<string, unknown> {
	const result = project.projectBin.clips.find((clip) => clip.id === id);
	assert.ok(result);
	return result as Record<string, unknown>;
}

function keyframes(clip: Record<string, unknown>): Record<string, unknown> {
	assert.ok(clip.videoKeyframes && typeof clip.videoKeyframes === 'object');
	return clip.videoKeyframes as Record<string, unknown>;
}

function domain(clip: Record<string, unknown>): unknown {
	return keyframes(clip).timeDomain;
}

function curvePath(clip: Record<string, unknown>): {
	readonly anchors: ReadonlyArray<{ readonly position: unknown }>;
} {
	return ((keyframes(clip).curves as Array<{ curve: unknown }>)[0]!).curve as {
		readonly anchors: ReadonlyArray<{ readonly position: unknown }>;
	};
}

function firstEffectId(clip: Record<string, unknown>): unknown {
	return (clip.videoEffects as Array<{ id: unknown }>)[0]?.id;
}

function firstCurveValue(clip: Record<string, unknown>): unknown {
	return (keyframes(clip).curves as Array<{ curve: { anchors: Array<{ value: unknown }> } }>)[0]
		?.curve.anchors[0]?.value;
}

function effectTarget(clip: Record<string, unknown>): unknown {
	const curves = keyframes(clip).curves as Array<{ target: Record<string, unknown> }>;
	return curves.find(({ target }) => target.kind === 'video-effect')?.target.effectId;
}

function domainValue(authoredDuration: number, viewStart: number, viewDuration: number) {
	return {
		authoredDuration: { num: authoredDuration, den: 1 },
		viewStart: { num: viewStart, den: 1 },
		viewDuration: { num: viewDuration, den: 1 },
	};
}

function stableIds(): (prefix?: string) => string {
	let next = 0;
	return (prefix = 'id') => `${prefix}-${String(next++)}`;
}
