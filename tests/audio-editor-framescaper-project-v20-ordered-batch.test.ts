/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	applyFramescaperProjectCommandV20,
	type FramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-commands.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

test('V20 ordered batch defaults a keyless V6 paste before setting its fresh clip', () => {
	const project = fixture();
	const edited = apply(project, {
		type: 'batch',
		commands: [
			videoPasteCommand(),
			setKeyframes('pasted-video', createDefaultVideoKeyframeCurves(10), opacityKeyframes()),
		],
	});
	assert.equal(edited.revision, project.revision + 1);
	assert.deepEqual(keyframes(edited, 'pasted-video'), opacityKeyframes());
});

test('V20 completes a keyless V6 paste carrier before an inherited split consumes it', () => {
	const project = fixture();
	const split = apply(project, {
		type: 'batch',
		commands: [videoPasteCommand(), splitPastedVideo()],
	});
	assert.equal(split.revision, project.revision + 1);
	assert.deepEqual(keyframes(split, 'pasted-video'), defaultSplitKeyframes(0));
	assert.deepEqual(keyframes(split, 'right-video'), defaultSplitKeyframes(5));
});

test('V20 orders keyless V6 paste, inherited split, then a right-child keyframe set', () => {
	const project = fixture();
	const expected = defaultSplitKeyframes(5);
	const next = rightAuthoredKeyframes();
	const edited = apply(project, {
		type: 'batch',
		commands: [
			videoPasteCommand(),
			splitPastedVideo(),
			setKeyframes('right-video', expected, next),
		],
	});
	assert.equal(edited.revision, project.revision + 1);
	assert.deepEqual(keyframes(edited, 'pasted-video'), defaultSplitKeyframes(0));
	assert.deepEqual(keyframes(edited, 'right-video'), next);
});

test('V20 ordered batch defaults clip/add before set and rolls back a stale later child', () => {
	const project = fixture();
	const add = videoAddCommand('added-video', 10);
	const edited = apply(project, {
		type: 'batch',
		commands: [
			add,
			setKeyframes('added-video', createDefaultVideoKeyframeCurves(10), opacityKeyframes()),
		],
	});
	assert.equal(edited.revision, project.revision + 1);
	assert.deepEqual(keyframes(edited, 'added-video'), opacityKeyframes());

	const before = structuredClone(project);
	assert.throws(() => apply(project, {
		type: 'batch',
		commands: [
			add,
			setKeyframes('added-video', opacityKeyframes(), opacityKeyframes()),
		],
	}), /changed|stale/iu);
	assert.deepEqual(project, before);
	assert.equal(project.clips.some(({ id }) => id === 'added-video'), false);
});

test('V20 treats remove then keyless same-ID add as a fresh video occurrence', () => {
	const seeded = apply(fixture(), setKeyframes(
		'video-clip', createDefaultVideoKeyframeCurves(10), opacityKeyframes(),
	));
	const edited = apply(seeded, {
		type: 'batch',
		commands: [
			{ type: 'clip/remove', clipId: 'video-clip' },
			videoAddCommand('video-clip', 0),
		],
	});
	assert.equal(edited.revision, seeded.revision + 1);
	assert.deepEqual(keyframes(edited, 'video-clip'), createDefaultVideoKeyframeCurves(10));
});

test('V20 defaults remove-many then same-ID add before a later keyframe set', () => {
	const seeded = apply(fixture(), setKeyframes(
		'video-clip', createDefaultVideoKeyframeCurves(10), opacityKeyframes(),
	));
	const edited = apply(seeded, {
		type: 'batch',
		commands: [
			{ type: 'clip/remove-many', clipIds: ['video-clip'] },
			videoAddCommand('video-clip', 0),
			setKeyframes(
				'video-clip', createDefaultVideoKeyframeCurves(10), opacityKeyframes(),
			),
		],
	});
	assert.equal(edited.revision, seeded.revision + 1);
	assert.deepEqual(keyframes(edited, 'video-clip'), opacityKeyframes());
});

test('V20 coalesces 10k inherited children into one caller-visible publication', () => {
	const project = fixture() as unknown as Record<string, unknown>;
	project.revision = Number.MAX_SAFE_INTEGER - 1;
	let timestampCalls = 0;
	class CountingDate extends Date {
		public override toISOString(): string {
			timestampCalls += 1;
			return super.toISOString();
		}
	}
	const inherited = Array.from({ length: 10_000 }, (_, index) => ({
		type: 'project/rename' as const,
		title: `Rename ${String(index)}`,
	}));
	const edited = apply(project as unknown as FramescaperProjectV20, {
		type: 'batch', commands: inherited,
	}, { now: new CountingDate('2026-08-13T12:10:00.000Z') });
	assert.equal(edited.revision, Number.MAX_SAFE_INTEGER);
	assert.equal(edited.title, 'Rename 9999');
	assert.equal(edited.updatedAt, '2026-08-13T12:10:00.000Z');
	assert.equal(timestampCalls, 1);
});

test('V20 mixed segments consume exactly the outer revision at the safe-integer edge', () => {
	const project = fixture() as unknown as Record<string, unknown>;
	project.revision = Number.MAX_SAFE_INTEGER - 1;
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [
			{ type: 'project/rename', title: 'Before set' },
			setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), opacityKeyframes()),
			{ type: 'project/rename', title: 'After set' },
		],
	};
	const edited = apply(project as unknown as FramescaperProjectV20, command);
	assert.equal(edited.revision, Number.MAX_SAFE_INTEGER);
	assert.equal(edited.title, 'After set');
	assert.deepEqual(keyframes(edited, 'video-clip'), opacityKeyframes());

	assert.throws(
		() => apply(edited, command),
		/revision overflow/iu,
	);
});

function videoPasteCommand(): AudioEditorCommand {
	return {
		type: 'clipboard/paste',
		clipboard: {
			schemaVersion: 6, sampleRate: 48_000, durationFrames: 48_000,
			tracks: [{
				sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
				sourceLaneGroupId: null, sourceSequenceId: 'main-sequence',
				clips: [{
					key: 'video-copy', kind: 'video', sourceId: 'video-source', offsetFrame: 0,
					sourceStartFrame: 0, sourceDurationFrames: 10, durationFrames: 48_000,
					sequenceId: 'main-sequence', sequenceFrameCount: 10,
					videoEffects: [], videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				}],
			}],
			annotations: [], takeGroups: [],
		},
		atFrame: 48_000, mode: 'reject', trackMap: { 'video-track': 'video-track' },
		clipIds: { 'video-copy': 'pasted-video' }, groupIds: {}, avLinkIds: {},
		videoEffectIds: { 'video-copy': [] }, splitClipIds: {}, splitAvLinkIds: {},
		sequenceMap: { 'main-sequence': 'main-sequence' }, annotationIds: {},
		annotationBatchIds: {}, takeGroupIds: {}, takeLaneIds: {}, takeIds: {}, compRegionIds: {},
	};
}

function videoAddCommand(id: string, sequenceStartFrame: number): AudioEditorCommand {
	return {
		type: 'clip/add',
		trackId: 'video-track',
		clip: {
			kind: 'video', id, sourceId: 'video-source', title: 'Added video',
			sequenceId: 'main-sequence', sequenceStartFrame, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		},
	};
}

function setKeyframes(clipId: string, expectedKeyframes: unknown, next: unknown): AudioEditorCommand {
	return { type: 'video-keyframes/set', clipId, expectedKeyframes, keyframes: next } as AudioEditorCommand;
}

function splitPastedVideo(): AudioEditorCommand {
	return {
		type: 'clip/split', clipId: 'pasted-video', atFrame: 72_000, rightClipId: 'right-video',
	};
}

function defaultSplitKeyframes(viewStart: 0 | 5): Record<string, unknown> {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: 10, den: 1 },
			viewStart: { num: viewStart, den: 1 },
			viewDuration: { num: 5, den: 1 },
		},
		curves: [],
	};
}

function rightAuthoredKeyframes(): Record<string, unknown> {
	return { ...opacityKeyframes(), timeDomain: defaultSplitKeyframes(5).timeDomain };
}

function fixture(): FramescaperProjectV20 {
	return createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, framescaperV20Options());
}

function apply(
	project: FramescaperProjectV20,
	command: AudioEditorCommand,
	options: Readonly<{ now?: Date | string }> = {},
): FramescaperProjectV20 {
	return applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		project,
		command as FramescaperProjectCommandV20,
		options,
	);
}

function keyframes(project: FramescaperProjectV20, id: string): unknown {
	const clip = project.clips.find((candidate) => candidate.id === id);
	assert.ok(clip);
	return Object.getOwnPropertyDescriptor(clip, 'videoKeyframes')?.value;
}
