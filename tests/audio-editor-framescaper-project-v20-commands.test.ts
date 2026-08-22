/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createDefaultVideoKeyframeCurves } from '../src/common/editor/video-keyframe-curves.ts';
import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	normalizeVideoClipComposition,
} from '../src/common/editor/video-clip-composition.ts';
import {
	FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	applyFramescaperProjectCommandV20,
	type FramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-commands.ts';
import {
	cloneFramescaperProjectHistoryV20,
	createFramescaperProjectHistoryV20,
	executeFramescaperProjectCommandV20,
	redoFramescaperProjectCommandV20,
	undoFramescaperProjectCommandV20,
	validateFramescaperProjectHistoryV20,
} from '../src/framescaper/editor-project-v20-history.ts';
import {
	FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_NODES,
} from '../src/framescaper/editor-project-v20-history-admission.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const EDITED = '2026-08-13T12:01:00.000Z';
const UNDONE = '2026-08-13T12:02:00.000Z';
const REDONE = '2026-08-13T12:03:00.000Z';

test('V20 replaces timeline and Project Bin keyframes stale-safely and reconciles ownership', () => {
	const project = projectFixture();
	const expected = videoKeyframes(project, 'video-clip');
	const authored = opacityKeyframes();
	const edited = apply(project, setKeyframes('video-clip', expected, authored), EDITED);
	assert.deepEqual(videoKeyframes(project, 'video-clip'), expected);
	assert.deepEqual(videoKeyframes(edited, 'video-clip'), authored);
	assert.notStrictEqual(videoKeyframes(edited, 'video-clip'), authored);
	assert.equal(edited.revision, project.revision + 1);
	assert.equal(edited.updatedAt, EDITED);
	assert.equal(hasKeyframeRequirement(edited), true);
	assert.equal(validateFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, edited), true);

	const binExpected = videoKeyframes(edited, 'bin-video', 'project-bin');
	const withBin = apply(edited, setKeyframes('bin-video', binExpected, authored));
	assert.deepEqual(videoKeyframes(withBin, 'bin-video', 'project-bin'), authored);
	assert.deepEqual(videoKeyframes(withBin, 'video-clip'), authored);

	const reset = apply(withBin, {
		type: 'batch',
		commands: [
			setKeyframes('video-clip', authored, createDefaultVideoKeyframeCurves(10)),
			setKeyframes('bin-video', authored, createDefaultVideoKeyframeCurves(10)),
		],
	});
	assert.equal(hasKeyframeRequirement(reset), false);
});

test('V20 inherited V19 and common commands preserve keyframes and default new video occurrences', () => {
	const authored = opacityKeyframes();
	const keyed = apply(
		projectFixture(),
		setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), authored),
	);
	const composed = apply(keyed, {
		type: 'video-composition/set',
		clipId: 'video-clip',
		expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		composition: authoredComposition(),
	});
	assert.deepEqual(videoKeyframes(composed, 'video-clip'), authored);
	assert.notStrictEqual(videoKeyframes(composed, 'video-clip'), videoKeyframes(keyed, 'video-clip'));

	const renamed = apply(composed, { type: 'project/rename', title: 'Renamed exact V20' });
	assert.equal(renamed.title, 'Renamed exact V20');
	assert.deepEqual(videoKeyframes(renamed, 'video-clip'), authored);

	const added = apply(renamed, {
		type: 'project-bin/add',
		clip: {
			kind: 'video', id: 'new-bin-video', sourceId: 'video-source', title: 'New bin video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			binItemId: 'new-bin-video', videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		},
	});
	assert.deepEqual(
		videoKeyframes(added, 'new-bin-video', 'project-bin'),
		createDefaultVideoKeyframeCurves(10),
	);
	assert.deepEqual(videoKeyframes(added, 'video-clip'), authored);
});

test('V20 defaults keyframes on video occurrences allocated by insert and overwrite edits', () => {
	for (const mode of ['insert', 'overwrite'] as const) {
		const clipId = `${mode}-video`;
		const edited = apply(projectFixture(), {
			type: `edit/${mode}`, startFrame: mode === 'insert' ? 48_000 : 0,
			endFrame: mode === 'insert' ? 96_000 : 48_000, trackIds: ['video-track'],
			placements: [{ trackId: 'video-track', clipId, sourceId: 'video-source',
				kind: 'video', sourceIn: 0, sourceCount: 10 }],
			splitClipIds: {}, splitAvLinkIds: {}, videoEffectIds: {},
		});
		assert.deepEqual(videoKeyframes(edited, clipId), createDefaultVideoKeyframeCurves(10));
	}
});
test('V20 private inherited edits partition and rejoin keyframes without opening public V19', () => {
	const authored = opacityKeyframes();
	const keyed = apply(
		projectFixture(),
		setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), authored),
	);
	const split = apply(keyed, {
		type: 'clip/split', clipId: 'video-clip', atFrame: 24_000, rightClipId: 'right-video',
	});
	assert.deepEqual(
		videoKeyframes(split, 'video-clip').timeDomain,
		keyframeDomain(10, 0, 5),
	);
	assert.deepEqual(
		videoKeyframes(split, 'right-video').timeDomain,
		keyframeDomain(10, 5, 5),
	);
	assert.deepEqual(
		videoKeyframes(split, 'video-clip').curves,
		videoKeyframes(split, 'right-video').curves,
	);
	assert.notStrictEqual(
		videoKeyframes(split, 'video-clip'),
		videoKeyframes(split, 'right-video'),
	);

	const joined = apply(split, { type: 'clip/join', clipIds: ['video-clip', 'right-video'] });
	assert.equal(joined.clips.length, keyed.clips.length);
	assert.deepEqual(videoKeyframes(joined, 'video-clip').timeDomain, keyframeDomain(10, 0, 10));
	assert.deepEqual(videoKeyframes(joined, 'video-clip').curves, authored.curves);
});

test('V20 inherited Project Bin move and placement retain detached authored keyframes', () => {
	const authored = opacityKeyframes();
	const keyed = apply(
		projectFixture(),
		setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), authored),
	);
	const moved = apply(keyed, {
		type: 'project-bin/move-from-timeline', clipIds: ['video-clip'],
	});
	assert.deepEqual(videoKeyframes(moved, 'video-clip', 'project-bin'), authored);
	assert.notStrictEqual(
		videoKeyframes(moved, 'video-clip', 'project-bin'),
		videoKeyframes(keyed, 'video-clip'),
	);

	const placed = apply(moved, {
		type: 'project-bin/place',
		binClipId: 'video-clip',
		timelineStartFrame: 0,
		placements: [{
			binClipId: 'video-clip', trackId: 'video-track', clipId: 'placed-video',
		}],
	});
	assert.deepEqual(videoKeyframes(placed, 'placed-video'), authored);
	assert.notStrictEqual(
		videoKeyframes(placed, 'placed-video'),
		videoKeyframes(moved, 'video-clip', 'project-bin'),
	);
});

test('V20 defaults keyless current video clipboard paste and rejects legacy V5 video paste', () => {
	const project = projectFixture();
	const pasted = apply(project, videoPasteCommand(6));
	assert.deepEqual(
		videoKeyframes(pasted, 'pasted-video'),
		createDefaultVideoKeyframeCurves(10),
	);
	assert.equal(hasKeyframeRequirement(pasted), false);
	assert.throws(
		() => apply(project, videoPasteCommand(5)),
		/V6 recopy/iu,
	);
});

test('V20 trim persists the exact authored view and history restores it through undo and redo', () => {
	const authored = opacityKeyframes();
	const keyed = apply(
		projectFixture(),
		setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), authored),
	);
	const trim: AudioEditorCommand = {
		type: 'clip/trim',
		clipId: 'video-clip',
		timelineStartFrame: 9_600,
		durationFrames: 28_800,
		sourceStartFrame: 2,
		sourceDurationFrames: 6,
	};
	const trimmed = apply(keyed, trim, EDITED);
	assert.equal(videoClip(trimmed, 'video-clip').sequenceFrameCount, 6);
	assert.deepEqual(videoKeyframes(trimmed, 'video-clip').timeDomain, keyframeDomain(10, 2, 6));
	assert.deepEqual(videoKeyframes(trimmed, 'video-clip').curves, authored.curves);

	let history = executeFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		createFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, keyed),
		trim as FramescaperProjectCommandV20,
		{ now: EDITED },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip').timeDomain, keyframeDomain(10, 2, 6));
	history = undoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: UNDONE },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip').timeDomain, keyframeDomain(10, 0, 10));
	history = redoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: REDONE },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip').timeDomain, keyframeDomain(10, 2, 6));
});

test('a mixed V20 batch is one revision and a late stale child publishes no partial result', () => {
	const project = projectFixture();
	const expected = videoKeyframes(project, 'video-clip');
	const authored = opacityKeyframes();
	const edited = apply(project, {
		type: 'batch',
		commands: [
			{ type: 'project/rename', title: 'One transaction' },
			{
				type: 'batch',
				commands: [
					setKeyframes('video-clip', expected, authored),
					setKeyframes(
						'bin-video',
						videoKeyframes(project, 'bin-video', 'project-bin'),
						authored,
					),
				],
			},
		],
	}, EDITED);
	assert.equal(edited.title, 'One transaction');
	assert.equal(edited.revision, project.revision + 1);
	assert.equal(edited.updatedAt, EDITED);
	assert.deepEqual(videoKeyframes(edited, 'video-clip'), authored);
	assert.deepEqual(videoKeyframes(edited, 'bin-video', 'project-bin'), authored);
	let history = executeFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		createFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project),
		{
			type: 'batch',
			commands: [
				{ type: 'project/rename', title: 'History transaction' },
				setKeyframes('video-clip', expected, authored),
			],
		},
		{ now: EDITED },
	);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.present.revision, project.revision + 1);
	history = undoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: UNDONE },
	);
	assert.equal(history.present.title, project.title);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), expected);
	assert.equal(history.redoStack.length, 1);
	history = redoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: REDONE },
	);
	assert.equal(history.present.title, 'History transaction');
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), authored);

	const before = structuredClone(project);
	assert.throws(() => apply(project, {
		type: 'batch',
		commands: [
			{ type: 'project/rename', title: 'Must not publish' },
			setKeyframes('video-clip', authored, authored),
		],
	}), /changed|stale/iu);
	assert.deepEqual(project, before);
});

test('a mixed V20 batch trims one occurrence while setting detached Project Bin keyframes', () => {
	const authored = opacityKeyframes();
	const project = apply(
		projectFixture(),
		setKeyframes('video-clip', createDefaultVideoKeyframeCurves(10), authored),
	);
	const trim: AudioEditorCommand = {
		type: 'clip/trim',
		clipId: 'video-clip',
		timelineStartFrame: 9_600,
		durationFrames: 28_800,
		sourceStartFrame: 2,
		sourceDurationFrames: 6,
	};
	const edited = apply(project, {
		type: 'batch',
		commands: [
			trim,
			setKeyframes(
				'bin-video',
				videoKeyframes(project, 'bin-video', 'project-bin'),
				authored,
			),
		],
	}, EDITED);
	assert.equal(edited.revision, project.revision + 1);
	assert.equal(videoClip(edited, 'video-clip').sequenceFrameCount, 6);
	assert.deepEqual(videoKeyframes(edited, 'video-clip').timeDomain, keyframeDomain(10, 2, 6));
	assert.deepEqual(videoKeyframes(edited, 'video-clip').curves, authored.curves);
	assert.deepEqual(videoKeyframes(edited, 'bin-video', 'project-bin'), authored);
});

test('V20 keyframe commands reject audio, ambiguity, locked tracks, and invalid next state atomically', () => {
	const project = projectFixture();
	const before = structuredClone(project);
	const authored = opacityKeyframes();
	assert.throws(
		() => apply(project, setKeyframes('audio-clip', authored, authored)),
		/not a video clip/iu,
	);
	const ambiguous = structuredClone(project) as unknown as Record<string, unknown>;
	const ambiguousBin = ((ambiguous.projectBin as Record<string, unknown>).clips as Record<string, unknown>[])[0]!;
	ambiguousBin.id = 'video-clip';
	assert.throws(
		() => apply(ambiguous as unknown as FramescaperProjectV20, setKeyframes(
			'video-clip', createDefaultVideoKeyframeCurves(10), authored,
		)),
		/globally unique|duplicate ID/iu,
	);
	const locked = structuredClone(project) as unknown as Record<string, unknown>;
	((locked.tracks as Record<string, unknown>[])[0]!).locked = true;
	assert.throws(
		() => apply(locked as unknown as FramescaperProjectV20, setKeyframes(
			'video-clip', createDefaultVideoKeyframeCurves(10), authored,
		)),
		/locked/iu,
	);
	const invalid = structuredClone(authored) as Record<string, unknown>;
	(((invalid.curves as Record<string, unknown>[])[0]!.curve as Record<string, unknown>)
		.anchors as Record<string, unknown>[])[0]!.value = 2;
	assert.throws(
		() => apply(project, setKeyframes(
			'video-clip', createDefaultVideoKeyframeCurves(10), invalid,
		)),
		/range/iu,
	);
	assert.deepEqual(project, before);
});

test('V20 history owns detached commands and projects through undo and redo', () => {
	const project = projectFixture();
	const authored = opacityKeyframes();
	const authoredSnapshot = structuredClone(authored);
	const command = setKeyframes(
		'video-clip', videoKeyframes(project, 'video-clip'), authored,
	) as unknown as Record<string, unknown>;
	let history = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		project,
		{ limit: 2 },
	);
	const beforeFailure = structuredClone(history);
	assert.throws(
		() => executeFramescaperProjectCommandV20(
			FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
			history,
			setKeyframes('video-clip', authored, authored) as FramescaperProjectCommandV20,
		),
		/changed|stale/iu,
	);
	assert.deepEqual(history, beforeFailure);
	history = executeFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		history,
		command as unknown as FramescaperProjectCommandV20,
		{ now: EDITED },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), authoredSnapshot);
	((((command.keyframes as Record<string, unknown>).curves as Record<string, unknown>[])[0]!
		.curve as Record<string, unknown>).anchors as Record<string, unknown>[])[0]!.value = 0.5;
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), authoredSnapshot);
	assert.deepEqual(
		(history.undoStack[0]?.command as Readonly<Record<string, unknown>>).keyframes,
		authoredSnapshot,
	);

	const editedRevision = history.present.revision;
	history = undoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: UNDONE },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), createDefaultVideoKeyframeCurves(10));
	assert.equal(hasKeyframeRequirement(history.present), false);
	assert.equal(history.present.revision, editedRevision + 1);
	assert.equal(history.present.updatedAt, UNDONE);

	const undoneRevision = history.present.revision;
	history = redoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history, { now: REDONE },
	);
	assert.deepEqual(videoKeyframes(history.present, 'video-clip'), authoredSnapshot);
	assert.equal(hasKeyframeRequirement(history.present), true);
	assert.equal(history.present.revision, undoneRevision + 1);
	assert.equal(history.present.updatedAt, REDONE);
	assert.equal(validateFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history,
	), true);

	const clone = cloneFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history);
	assert.deepEqual(clone, history);
	assert.notStrictEqual(clone.present, history.present);
	assert.notStrictEqual(clone.undoStack[0]?.command, history.undoStack[0]?.command);
	assert.throws(
		() => createFramescaperProjectHistoryV20(
			FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project, { limit: 201 },
		),
		/1 through 200/iu,
	);
});

test('V20 history rejects accessor and custom-prototype stacks before collection methods run', () => {
	const project = projectFixture();
	const history = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project, { limit: 2 },
	) as unknown as Record<string, unknown>;
	let reads = 0;
	Object.defineProperty(history, 'undoStack', {
		enumerable: true,
		get: () => { reads += 1; return []; },
	});
	assert.throws(
		() => validateFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history),
		/enumerable data propert/iu,
	);
	assert.equal(reads, 0);

	const hostile = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project, { limit: 2 },
	) as unknown as Record<string, unknown>;
	let maps = 0;
	const stack = Object.setPrototypeOf([], {
		map: () => { maps += 1; throw new Error('hostile map'); },
		slice: () => { maps += 1; throw new Error('hostile slice'); },
		at: () => { maps += 1; throw new Error('hostile at'); },
	});
	hostile.undoStack = stack;
	assert.throws(
		() => cloneFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, hostile),
		/ordinary arrays/iu,
	);
	assert.equal(maps, 0);
});

test('V20 history applies one aggregate structure budget before per-entry semantic validation', () => {
	const project = projectFixture();
	const history = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project, { limit: 2 },
	) as unknown as Record<string, unknown>;
	history.undoStack = Array.from({
		length: FRAMESCAPER_V20_HISTORY_MAXIMUM_TRAVERSAL_NODES,
	}, () => 0);
	assert.throws(
		() => validateFramescaperProjectHistoryV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, history),
		/aggregate structural node limit/iu,
	);
});

function projectFixture(): FramescaperProjectV20 {
	return createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		framescaperV20Options(),
	);
}

function apply(
	project: FramescaperProjectV20,
	command: AudioEditorCommand | FramescaperProjectCommandV20,
	now?: string,
): FramescaperProjectV20 {
	return applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		project,
		command as FramescaperProjectCommandV20,
		{ now },
	);
}

function setKeyframes(
	clipId: string,
	expectedKeyframes: unknown,
	keyframes: unknown,
): AudioEditorCommand {
	return { type: 'video-keyframes/set', clipId, expectedKeyframes, keyframes } as AudioEditorCommand;
}

function videoPasteCommand(schemaVersion: 5 | 6): AudioEditorCommand {
	return {
		type: 'clipboard/paste',
		clipboard: {
			schemaVersion,
			sampleRate: 48_000,
			durationFrames: 48_000,
			tracks: [{
				sourceTrackId: 'video-track',
				sourceTrackName: 'Video',
				sourceTrackType: 'video',
				sourceLaneGroupId: null,
				sourceSequenceId: 'main-sequence',
				clips: [{
					key: 'video-copy',
					kind: 'video',
					sourceId: 'video-source',
					offsetFrame: 0,
					sourceStartFrame: 0,
					sourceDurationFrames: 10,
					durationFrames: 48_000,
					sequenceId: 'main-sequence',
					sequenceFrameCount: 10,
					videoEffects: [],
					videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				}],
			}],
			annotations: [],
			takeGroups: [],
		},
		atFrame: 48_000,
		mode: 'reject',
		trackMap: { 'video-track': 'video-track' },
		clipIds: { 'video-copy': 'pasted-video' },
		groupIds: {},
		avLinkIds: {},
		videoEffectIds: { 'video-copy': [] },
		splitClipIds: {},
		splitAvLinkIds: {},
		sequenceMap: { 'main-sequence': 'main-sequence' },
		annotationIds: {},
		annotationBatchIds: {},
		takeGroupIds: {},
		takeLaneIds: {},
		takeIds: {},
		compRegionIds: {},
	};
}

function videoKeyframes(
	project: FramescaperProjectV20,
	id: string,
	scope: 'timeline' | 'project-bin' = 'timeline',
): Readonly<Record<string, unknown>> {
	const collection = scope === 'timeline' ? project.clips : project.projectBin.clips;
	const found = collection.find((candidate) => candidate.id === id);
	assert.ok(found);
	const descriptor = Object.getOwnPropertyDescriptor(found, 'videoKeyframes');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
	return descriptor.value as Readonly<Record<string, unknown>>;
}

function videoClip(project: FramescaperProjectV20, id: string): Readonly<Record<string, unknown>> {
	const found = project.clips.find((candidate) => candidate.id === id);
	assert.ok(found);
	return found;
}

function hasKeyframeRequirement(project: FramescaperProjectV20): boolean {
	return project.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20.id,
	);
}

function authoredComposition() {
	return normalizeVideoClipComposition({
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		opacity: 0.5,
		blendMode: 'multiply',
	});
}

function keyframeDomain(authoredDuration: number, viewStart: number, viewDuration: number) {
	return {
		authoredDuration: { num: authoredDuration, den: 1 },
		viewStart: { num: viewStart, den: 1 },
		viewDuration: { num: viewDuration, den: 1 },
	};
}
