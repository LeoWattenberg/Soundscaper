/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { mapFramescaperImageTimelineFrameV1 } from '../src/common/editor/timeline-image-model.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';

for (const atFrame of [48_000, 336_000]) test(`a normal image split at sample ${String(atFrame)} preserves sequence extents and animated source frames`, () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const before = runtime.createHistory(fixture.project);
	let history = runtime.executeCommand(before, { type: 'clip/split', clipId: fixture.clip.id, atFrame, rightClipId: 'right-image' });
	const left = history.present.clips.find(clip => clip.id === fixture.clip.id);
	const right = history.present.clips.find(clip => clip.id === 'right-image');
	assert.ok(left?.kind === 'image');
	assert.ok(right?.kind === 'image');
	const boundary = atFrame / 4_800;
	assert.deepEqual(left, { ...fixture.clip, sequenceFrameCount: boundary });
	assert.deepEqual(right, { ...fixture.clip, id: 'right-image', sequenceStartFrame: boundary,
		sequenceFrameCount: 150 - boundary, sourceStartTicks: String(Math.min(atFrame / 48_000 * 1_000_000, 4_999_999)) });
	const timings = [{ presentationTicks: 0n, durationTicks: 1_000_000n },
		{ presentationTicks: 1_000_000n, durationTicks: 4_000_000n }];
	for (const sequenceFrame of [boundary, boundary + 3, 149]) {
		const original = mapFramescaperImageTimelineFrameV1({ clip: fixture.clip, sequenceFrame,
			sequenceRate: { num: 10, den: 1 }, timings });
		const split = mapFramescaperImageTimelineFrameV1({ clip: right, sequenceFrame,
			sequenceRate: { num: 10, den: 1 }, timings });
		assert.equal(split.frameIndex, original.frameIndex);
	}
	assert.deepEqual(history.present.sources, before.present.sources);
	const after = history.present;
	history = runtime.undo(history);
	assert.deepEqual(history.present, { ...before.present, revision: history.present.revision, updatedAt: history.present.updatedAt });
	history = runtime.redo(history);
	assert.deepEqual(history.present, { ...after, revision: history.present.revision, updatedAt: history.present.updatedAt });
});

test('two ordinary cut positions in one split-tool gesture retain all three exact image leaves', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const history = runtime.executeCommand(runtime.createHistory(fixture.project), { type: 'batch', commands: [{
		type: 'clip/split', clipId: fixture.clip.id, atFrame: 96_000, rightClipId: 'last-image',
	}, { type: 'clip/split', clipId: fixture.clip.id, atFrame: 48_000, rightClipId: 'middle-image' }] });
	assert.deepEqual(history.present.clips.filter(clip => clip.kind === 'image')
		.map(clip => [clip.id, clip.sequenceStartFrame, clip.sequenceFrameCount]).sort((left, right) => Number(left[1]) - Number(right[1])),
	[[fixture.clip.id, 0, 10], ['middle-image', 10, 10], ['last-image', 20, 130]]);
});

test('the ordinary split-into-new-track compound moves the new image leaf with its source phase', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const history = runtime.executeCommand(runtime.createHistory(fixture.project), { type: 'batch', commands: [
		createAddTrackCommand({ id: 'derived-picture', type: 'video', name: 'Picture 2' }),
		{ type: 'clip/split', clipId: fixture.clip.id, atFrame: 48_000, rightClipId: 'right-image' },
		{ type: 'clip/move', clipId: 'right-image', trackId: 'derived-picture', timelineStartFrame: 48_000 },
	] });
	assert.deepEqual(history.present.tracks.find(track => track.id === 'derived-picture')?.clipIds, ['right-image']);
	assert.deepEqual(history.present.clips.find(clip => clip.id === 'right-image'), {
		...fixture.clip, id: 'right-image', sequenceStartFrame: 10, sequenceFrameCount: 140, sourceStartTicks: '1000000',
	});
});
