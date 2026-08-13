/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	materializeFramescaperNestedPlaybackFoundationV18,
} from '../src/framescaper/editor-project-v18-nested-playback.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	framescaperProjectForPlaybackFoundationV18,
	framescaperProjectForRuntimeConsumersV18,
} from '../src/framescaper/editor-project-v18-runtime.ts';
import {
	createFramescaperProjectV18,
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-13T12:00:00.000Z';
const SOURCE_SHA = '12'.repeat(32);

test('exact schema 18 requires one own dense subsequences collection', () => {
	const project = aliasesProject();
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	delete missing.subsequences;
	assert.throws(
		() => validateFramescaperProjectV18(PROFILE, missing),
		/subsequences.*own enumerable data property/iu,
	);

	const sparse = structuredClone(project) as unknown as Record<string, unknown>;
	const values = (sparse.subsequences as unknown[]).slice();
	delete values[0];
	sparse.subsequences = values;
	assert.throws(
		() => validateFramescaperProjectV18(PROFILE, sparse),
		/subsequences.*dense|enumerable data property/iu,
	);
});

test('nested aliases materialize deterministically on the primary frame grid without mutating V18', () => {
	const project = aliasesProject();
	const persisted = structuredClone(project);
	const first = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);
	const second = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);

	assert.deepEqual(project, persisted);
	assert.deepEqual(second, first);
	assert.equal(first.schemaVersion, 17);
	assert.equal(Object.hasOwn(first, 'subsequences'), false);
	assert.equal(first.primarySequenceId, 'root');
	assert.equal(validateAudioEditorProjectV17(first), true);
	assert.equal(first.sequences.find(({ id }) => id === 'child')?.trackIds.length, 0);
	assert.equal(first.sequences.find(({ id }) => id === 'child')?.trackNodes.length, 0);

	const clips = [...first.clips].sort((left, right) => (
		Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame)
	));
	assert.deepEqual(clips.map((clip) => ({
		sequenceId: clip.sequenceId,
		sequenceStartFrame: clip.sequenceStartFrame,
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
	})), [
		{ sequenceId: 'root', sequenceStartFrame: 35, sequenceFrameCount: 15, sourceInFrame: 10, sourceFrameCount: 12 },
		{ sequenceId: 'root', sequenceStartFrame: 95, sequenceFrameCount: 15, sourceInFrame: 10, sourceFrameCount: 12 },
	]);
	assert.equal(new Set(clips.map(({ id }) => id)).size, 2);
	assert.ok(clips.every(({ id }) => String(id).startsWith('framescaper-v18-flat-clip-')));
	assert.equal(first.tracks.length, 2);
	assert.equal(new Set(first.tracks.map(({ id }) => id)).size, 2);
	assert.ok(first.tracks.every(({ id }) => String(id).startsWith('framescaper-v18-flat-track-')));
	assert.deepEqual(
		first.sequences.find(({ id }) => id === 'root')?.trackIds,
		first.tracks.map(({ id }) => id),
	);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.clips), true);
	assert.ok(first.clips.every(Object.isFrozen));
});

test('maintained playback and runtime consume the same primary-sequence materialization', () => {
	const project = aliasesProject();
	const foundation = materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project);
	assert.deepEqual(framescaperProjectForPlaybackFoundationV18(PROFILE, project), foundation);

	const runtime = framescaperProjectForRuntimeConsumersV18(PROFILE, project);
	const clips = [...runtime.clips].sort((left, right) => left.timelineStartFrame - right.timelineStartFrame);
	assert.deepEqual(clips.map(({ timelineStartFrame, timelineEndFrame, durationFrames }) => ({
		timelineStartFrame, timelineEndFrame, durationFrames,
	})), [
		{ timelineStartFrame: 56_000, timelineEndFrame: 80_000, durationFrames: 24_000 },
		{ timelineStartFrame: 152_000, timelineEndFrame: 176_000, durationFrames: 24_000 },
	]);
});

test('materialization refuses video boundaries that do not align exactly to the primary frame grid', () => {
	const project = aliasesProject();
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	const clip = (draft.clips as Record<string, unknown>[])[0]!;
	clip.sequenceStartFrame = 1;
	clip.sequenceFrameCount = 1;
	clip.sourceInFrame = 10;
	clip.sourceFrameCount = 1;
	assert.equal(validateFramescaperProjectV18(PROFILE, draft), true);
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationV18(PROFILE, draft),
		/primary.*frame grid|frame grid.*align/iu,
	);
});

test('materialization refuses trims that cannot map exactly to integer source frames', () => {
	const project = fractionalSourceProject();
	assert.throws(
		() => materializeFramescaperNestedPlaybackFoundationV18(PROFILE, project),
		/source.*frame grid|source.*align/iu,
	);
});

function aliasesProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-aliases', title: 'Nested playback aliases', now: NOW,
		sources: [videoSource('nested-source', 100, { num: 24, den: 1 })],
		clips: [{
			kind: 'video', id: 'child-clip', sourceId: 'nested-source', title: 'Child clip',
			sequenceId: 'child', sequenceStartFrame: 4, sequenceFrameCount: 12,
			sourceInFrame: 10, sourceFrameCount: 12, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'child-track', name: 'Child track', clipIds: ['child-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['child-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [
			{
				id: 'child-b', sequenceId: 'root', sourceSequenceId: 'child',
				sequenceStartFrame: 90, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
			{
				id: 'child-a', sequenceId: 'root', sourceSequenceId: 'child',
				sequenceStartFrame: 30, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
		],
	});
}

function fractionalSourceProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(PROFILE, {
		id: 'nested-playback-fractional-source', title: 'Fractional source', now: NOW,
		sources: [videoSource('fractional-source', 10, { num: 24, den: 1 })],
		clips: [{
			kind: 'video', id: 'fractional-clip', sourceId: 'fractional-source', title: 'Fractional clip',
			sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 3,
			sourceInFrame: 0, sourceFrameCount: 2, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'fractional-track', name: 'Fractional track', clipIds: ['fractional-clip'], locked: false,
		})],
		sequences: [
			{ id: 'root', rate: { num: 24, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 24, den: 1 }, trackIds: ['fractional-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [{
			id: 'fractional-placement', sequenceId: 'root', sourceSequenceId: 'child',
			sequenceStartFrame: 10, sequenceFrameCount: 1,
			sourceInFrame: 1, sourceFrameCount: 1,
		}],
	});
}

function videoSource(
	id: string,
	frameCount: number,
	rate: Readonly<{ num: number; den: number }>,
): Record<string, unknown> {
	return createVideoSourceV10({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256: SOURCE_SHA,
		sampleFrameCount: Math.ceil(frameCount * 48_000 * rate.den / rate.num),
		sourceFrameCount: frameCount, frameRate: rate, width: 1920, height: 1080,
	});
}
