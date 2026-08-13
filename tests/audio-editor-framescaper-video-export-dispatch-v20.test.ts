/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperProjectForRuntimeConsumersV20 } from '../src/framescaper/editor-project-v20-runtime.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	classifyFramescaperVideoExportDispatchV20,
} from '../src/framescaper/video-export-dispatch-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('classifies an exact active static range for legacy V6 without I/O', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const decision = classifyFramescaperVideoExportDispatchV20(
		PROFILE,
		project,
		{ startFrame: 12_000, endFrame: 36_000 },
	);

	assert.deepEqual(decision, {
		strategy: 'legacy-v6',
		range: { startFrame: 12_000, endFrame: 36_000, durationFrames: 24_000 },
		activeClipIds: ['video-clip'],
		activeSourceIds: ['video-source'],
	});
	assert.equal(Object.isFrozen(decision), true);
	assert.equal(Object.isFrozen(decision.range), true);
	assert.equal(Object.isFrozen(decision.activeClipIds), true);
	assert.equal(Object.isFrozen(decision.activeSourceIds), true);
});

test('selects keyed V20 only when an active runtime occurrence has authored curves', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	authorClip(project, 'video-clip');

	const decision = classifyFramescaperVideoExportDispatchV20(
		PROFILE,
		project,
		{ startFrame: 0, endFrame: 48_000 },
	);
	assert.equal(decision.strategy, 'keyed-v20');
	assert.deepEqual(decision.activeClipIds, ['video-clip']);
	assert.deepEqual(decision.activeSourceIds, ['video-source']);
});

test('ignores authored curves whose occurrences are outside the exact range', () => {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	const tracks = options.tracks as Record<string, unknown>[];
	const late = structuredClone(clips[0]!);
	late.id = 'late-keyed-clip';
	late.sequenceStartFrame = 10;
	clips.push(late);
	(tracks[0]!.clipIds as string[]).push('late-keyed-clip');
	const project = createFramescaperProjectV20(PROFILE, options);
	authorClip(project, 'late-keyed-clip');

	const decision = classifyFramescaperVideoExportDispatchV20(
		PROFILE,
		project,
		{ startFrame: 0, endFrame: 48_000 },
	);
	assert.equal(decision.strategy, 'legacy-v6');
	assert.deepEqual(decision.activeClipIds, ['video-clip']);
	assert.deepEqual(decision.activeSourceIds, ['video-source']);
});

test('classifies independently materialized keyed subsequence occurrences', () => {
	const project = nestedProject();
	const runtime = framescaperProjectForRuntimeConsumersV20(PROFILE, project);
	const occurrenceIds = runtime.clips.map(({ id }) => String(id));
	assert.equal(occurrenceIds.length, 2);
	assert.ok(occurrenceIds.every((id) => id !== 'leaf-clip'));

	const first = classifyFramescaperVideoExportDispatchV20(
		PROFILE,
		project,
		{ startFrame: 0, endFrame: 48_000 },
	);
	const second = classifyFramescaperVideoExportDispatchV20(
		PROFILE,
		project,
		{ startFrame: 48_000, endFrame: 96_000 },
	);
	assert.equal(first.strategy, 'keyed-v20');
	assert.equal(second.strategy, 'keyed-v20');
	assert.deepEqual(first.activeClipIds, [occurrenceIds[0]]);
	assert.deepEqual(second.activeClipIds, [occurrenceIds[1]]);
	assert.deepEqual(first.activeSourceIds, ['video-source']);
	assert.deepEqual(second.activeSourceIds, ['video-source']);
});

test('authenticates the V20 profile before reading a hostile project', () => {
	let reads = 0;
	const hostile = new Proxy({}, {
		get() { reads += 1; throw new Error('project get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('project descriptor'); },
		ownKeys() { reads += 1; throw new Error('project keys'); },
	});
	assert.throws(
		() => classifyFramescaperVideoExportDispatchV20({}, hostile, 'project'),
		/exact Framescaper V20 model profile/iu,
	);
	assert.equal(reads, 0);
});

test('authenticates the exact V20 project before reading a hostile range', () => {
	const project = structuredClone(
		createFramescaperProjectV20(PROFILE, framescaperV20Options()),
	) as unknown as Record<string, unknown>;
	project.schemaVersion = 19;
	let reads = 0;
	const range = new Proxy({}, {
		get() { reads += 1; throw new Error('range get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('range descriptor'); },
		ownKeys() { reads += 1; throw new Error('range keys'); },
	});
	assert.throws(
		() => classifyFramescaperVideoExportDispatchV20(PROFILE, project, range),
		/unsupported Framescaper project schema version/iu,
	);
	assert.equal(reads, 0);
});

test('rejects range and curve accessors without invoking them', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	let rangeReads = 0;
	const range = Object.defineProperty({ endFrame: 48_000 }, 'startFrame', {
		enumerable: true,
		get() { rangeReads += 1; return 0; },
	});
	assert.throws(
		() => classifyFramescaperVideoExportDispatchV20(PROFILE, project, range),
		/range\.startFrame.*data property/iu,
	);
	assert.equal(rangeReads, 0);

	let curveReads = 0;
	Object.defineProperty(project.clips[0], 'videoKeyframes', {
		enumerable: true,
		get() { curveReads += 1; return opacityKeyframes(); },
	});
	assert.throws(
		() => classifyFramescaperVideoExportDispatchV20(PROFILE, project, 'project'),
		/data propert/iu,
	);
	assert.equal(curveReads, 0);
});

function authorClip(project: ReturnType<typeof createFramescaperProjectV20>, clipId: string): void {
	const clip = project.clips.find(({ id }) => id === clipId);
	assert.ok(clip);
	(clip as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(10);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
}

function nestedProject(): ReturnType<typeof createFramescaperProjectV20> {
	const options = framescaperV20Options();
	options.clips = [{
		kind: 'video', id: 'leaf-clip', sourceId: 'video-source', title: 'Leaf', sequenceId: 'leaf',
		sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		retimeMap: null,
	}];
	options.tracks = [createVideoTrackV10({
		id: 'leaf-track', name: 'Leaf', clipIds: ['leaf-clip'], locked: false,
	})];
	options.sequences = [
		{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: [] },
		{ id: 'leaf', rate: { num: 10, den: 1 }, trackIds: ['leaf-track'] },
	];
	options.subsequences = [
		{
			id: 'a', sequenceId: 'main-sequence', sourceSequenceId: 'leaf',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		},
		{
			id: 'b', sequenceId: 'main-sequence', sourceSequenceId: 'leaf',
			sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		},
	];
	const project = createFramescaperProjectV20(PROFILE, options);
	authorClip(project, 'leaf-clip');
	return project;
}
