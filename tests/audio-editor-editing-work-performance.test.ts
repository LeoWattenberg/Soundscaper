/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectRelatedClipIds, resolveEditingSelectionAuthority, resolveEditingSelection } from '../src/common/editor/commands/editing-selection-authority.ts';
import { sortTrack, pruneMissingProjectSelections } from '../src/common/editor/commands/shared-runtime.js';
import { createCompletedFrameSum, firstById, clipOwnerIndex } from '../src/common/editor/commands/editing-work-index.ts';
import { transformClips } from '../src/common/editor/commands/clip-transform-runtime.js';
import { removeClips, replaceRenderedClips } from '../src/common/editor/commands/clip-basic-runtime.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import { brandRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

interface MutableCommandFixture extends Record<string, unknown> {
	clips: (Record<string, unknown> & { id: string; sourceId: string; timelineStartFrame: number; durationFrames: number; groupId?: string | null; gain?: number })[];
	tracks: { id: string; clipIds: string[] }[];
	sources: { id: string }[];
}

function commandFixture(count = 40): MutableCommandFixture {
	const clips = Array.from({ length: count }, (_, index) => createAudioClip({
		id: `clip-${String(index)}`, sourceId: 'source', timelineStartFrame: index * 100, durationFrames: 20,
	}));
	const tracks = clips.map((clip, index) => createAudioTrack({ id: `track-${String(index)}`, clipIds: [clip.id] }));
	const document = createCurrentAudioEditorProject({
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 10_000, channelCount: 1, sampleRate: 48_000 })], clips, tracks,
	});
	// Command handlers mutate their independently owned draft, unlike persisted model types.
	return brandRuntimeProjectProjection(structuredClone(projectForCommandConsumers(document))) as unknown as MutableCommandFixture;
}

void test('single clip transforms preserve unaffected track memberships and avoid unrelated clip geometry', () => {
	const project = commandFixture();
	const before = project.tracks.map(track => track.clipIds);
	let reads = 0;
	for (const clip of project.clips.slice(1)) {
		const frame = clip.timelineStartFrame;
		Object.defineProperty(clip, 'timelineStartFrame', { get: () => { reads += 1; return frame; }, configurable: true });
	}
	transformClips(project, { transforms: [{ clipId: 'clip-0', changes: { timelineStartFrame: 10 } }] });
	assert.equal(project.clips[0]?.timelineStartFrame, 10);
	assert.equal(reads, 0);
	for (let index = 1; index < project.tracks.length; index += 1) assert.equal(project.tracks[index]?.clipIds, before[index]);
});

void test('non-ripple removal does not read or sort removed clip timing', () => {
	const project = commandFixture();
	project.tracks[0]!.clipIds = project.clips.map(clip => clip.id);
	project.tracks.splice(1);
	let reads = 0;
	for (const clip of project.clips) {
		const frame = clip.timelineStartFrame;
		Object.defineProperty(clip, 'timelineStartFrame', { get: () => { reads += 1; return frame; }, configurable: true });
	}
	removeClips(project, ['clip-1', 'clip-0'], 'none');
	assert.equal(project.clips.length, 38);
	assert.equal(reads, 0);
});

void test('rendered replacement resolves independent components without repeatedly scanning unrelated identities', context => {
	const project = commandFixture(200);
	let reads = 0;
	for (const clip of project.clips) {
		const id = clip.id;
		Object.defineProperty(clip, 'id', { get: () => { reads += 1; return id; }, configurable: true, enumerable: true });
	}
	const entries = Array.from({ length: 25 }, (_, index) => ({ clipId: `clip-${String(index)}`, source: {
		id: `rendered-${String(index)}`, storageKey: `rendered-${String(index)}`, frameCount: 20, channelCount: 1,
	} }));
	replaceRenderedClips(project, { entries });
	context.diagnostic(`200 clips, 25 independent rendered targets: ${String(reads)} identity reads (baseline 20625)`);
	assert.ok(reads <= project.clips.length * 12, `identity reads: ${String(reads)}`);
	assert.equal(project.sources.length, 26);
	assert.equal(project.clips[24]?.sourceId, 'rendered-24');
	assert.equal(project.clips[25]?.sourceId, 'source');
	assert.equal(project.clips[24]?.timelineStartFrame, 2400);
});

void test('rendered duration changes scale related clips and ripple only their owned tracks', () => {
	const project = commandFixture(5);
	project.clips[0]!.groupId = 'related';
	project.clips[1]!.groupId = 'related';
	project.tracks[0]!.clipIds.push('clip-2');
	project.tracks[2]!.clipIds = [];
	const untouched = project.clips[4];
	replaceRenderedClips(project, { entries: [{ clipId: 'clip-0', source: {
		id: 'shorter', storageKey: 'shorter', frameCount: 10, channelCount: 1,
	} }] });
	assert.deepEqual(project.clips.slice(0, 3).map(clip => [clip.timelineStartFrame, clip.durationFrames]), [[0, 10], [50, 10], [140, 20]]);
	assert.equal(project.clips[1]?.sourceId, 'source');
	assert.equal(project.clips[0]?.gain, 1);
	assert.equal(project.clips[4], untouched);
	assert.equal(untouched?.timelineStartFrame, 400);
});

void test('direct rendered replacement keeps first-match slots when a mutable draft acquires duplicate IDs', () => {
	const project = commandFixture(2);
	project.clips[1]!.id = 'clip-0';
	const duplicate = project.clips[1];
	replaceRenderedClips(project, { rippleMode: 'none', entries: [{ clipId: 'clip-0', source: {
		id: 'rendered', storageKey: 'rendered', frameCount: 20, channelCount: 1,
	} }] });
	assert.equal(project.clips[0]?.sourceId, 'rendered');
	assert.equal(project.clips[1], duplicate);
	assert.equal(project.clips[1]?.sourceId, 'source');
});

void test('relationship chains visit each relationship a bounded number of times and preserve project order', context => {
	let reads = 0;
	const clips = Array.from({ length: 600 }, (_, index) => ({
		id: `clip-${String(index)}`,
		get groupId() { reads += 1; return `group-${String(Math.floor(index / 2))}`; },
		get avLinkId() { reads += 1; return `link-${String(Math.floor((index + 1) / 2))}`; },
	}));
	const ids = collectRelatedClipIds({ clips, tracks: [] }, ['clip-0', 'missing']);
	assert.deepEqual(ids, clips.map(clip => clip.id));
	context.diagnostic(`600-clip alternating relationship chain: ${String(reads)} relationship reads (baseline 1439400)`);
	assert.ok(reads <= clips.length * 6, `relationship reads: ${String(reads)}`);
});

void test('empty related selection never reads unrelated project clips', () => {
	let reads = 0;
	const project = { get clips() { reads += 1; return []; }, tracks: [] };
	assert.deepEqual(collectRelatedClipIds(project, []), []);
	assert.equal(reads, 0);
});

void test('selection ownership traverses each track membership once per resolution', context => {
	let reads = 0;
	const clips = Array.from({ length: 250 }, (_, index) => ({ id: `clip-${String(index)}`, timelineStartFrame: index * 20, durationFrames: 10 }));
	const tracks = clips.map(clip => ({ id: `track-${clip.id}`, get clipIds() { reads += 1; return [clip.id]; } }));
	const project = { clips, tracks, selection: { clipIds: clips.map(clip => clip.id) } };
	assert.equal(resolveEditingSelectionAuthority({ project }).clipTrackIds.length, tracks.length);
	context.diagnostic(`250 selected clips across 250 tracks: ${String(reads)} membership reads (baseline 31375)`);
	assert.ok(reads <= tracks.length * 2, `membership reads: ${String(reads)}`);
	reads = 0;
	assert.equal(resolveEditingSelection(project)?.trackIds.length, tracks.length);
	assert.ok(reads <= tracks.length * 3, `membership reads: ${String(reads)}`);
});

void test('sorting decorates geometry once and keeps deterministic code-unit ties', context => {
	let reads = 0;
	const clips = Array.from({ length: 1000 }, (_, index) => ({ get id() { reads += 1; return `clip-${String(index).padStart(4, '0')}`; }, timelineStartFrame: 1000 - index }));
	const track = { clipIds: clips.map(clip => clip.id) };
	reads = 0;
	sortTrack({ clips }, track);
	context.diagnostic(`1000-clip reversed track sort: ${String(reads)} identity reads (baseline 999999)`);
	assert.equal(track.clipIds[0], 'clip-0999');
	assert.ok(reads <= clips.length * 5, `identity reads: ${String(reads)}`);
	const tied = { clipIds: ['z', 'A', 'a'] };
	sortTrack({ clips: tied.clipIds.map(id => ({ id, timelineStartFrame: 0 })) }, tied);
	assert.deepEqual(tied.clipIds, ['A', 'a', 'z']);
	assert.throws(() => sortTrack({ clips: [] }, { clipIds: ['x', 'y'] }), /Unknown clip/u);
});

void test('sorting a small early track stops before scanning a large unrelated project tail', () => {
	let reads = 0;
	const clips = Array.from({ length: 10_000 }, (_, index) => ({ get id() { reads += 1; return `clip-${String(index)}`; }, timelineStartFrame: index }));
	const track = { clipIds: ['clip-1', 'clip-0'] };
	sortTrack({ clips }, track);
	assert.deepEqual(track.clipIds, ['clip-0', 'clip-1']);
	assert.ok(reads <= 10, `early-track identity reads: ${String(reads)}`);
});

void test('related selection and ownership follow mutations on the same caller-owned objects', () => {
	const clips = [{ id: 'a', groupId: 'g', timelineStartFrame: 0, durationFrames: 10 },
		{ id: 'b', groupId: null as string | null, timelineStartFrame: 20, durationFrames: 10 }];
	const tracks = [{ id: 'one', clipIds: ['a', 'b'] }, { id: 'two', clipIds: [] as string[] }];
	const project = { clips, tracks, selection: { clipIds: ['a'] } };
	assert.deepEqual(resolveEditingSelection(project)?.clipIds, ['a']);
	clips[1]!.groupId = 'g';
	tracks[0]!.clipIds = ['a'];
	tracks[1]!.clipIds = ['b'];
	assert.deepEqual(resolveEditingSelection(project)?.clipIds, ['a', 'b']);
	assert.deepEqual(resolveEditingSelection(project)?.trackIds, ['one', 'two']);
	tracks[1]!.clipIds = [];
	assert.throws(() => resolveEditingSelection(project), /not assigned/u);
});

void test('track ripple removal keeps overlap union and completed-boundary semantics', () => {
	const project = commandFixture(5);
	project.tracks[0]!.clipIds = project.clips.map(clip => clip.id);
	project.tracks.splice(1);
	project.clips[0]!.timelineStartFrame = 0;
	project.clips[1]!.timelineStartFrame = 10;
	project.clips[2]!.timelineStartFrame = 30;
	project.clips[3]!.timelineStartFrame = 45;
	project.clips[4]!.timelineStartFrame = 80;
	removeClips(project, ['clip-0', 'clip-1'], 'track');
	assert.deepEqual(project.clips.map(clip => [clip.id, clip.timelineStartFrame]), [['clip-2', 0], ['clip-3', 15], ['clip-4', 50]]);
	assert.deepEqual(project.tracks[0]?.clipIds, ['clip-2', 'clip-3', 'clip-4']);
});

void test('selection pruning only builds indexes for selected identity dimensions', () => {
	let reads = 0;
	const project = { get clips() { reads += 1; return []; }, get tracks() { reads += 1; return []; }, get timelineAnnotations() { reads += 1; return []; }, selection: { startFrame: 0, endFrame: 10 } };
	pruneMissingProjectSelections(project);
	assert.equal(reads, 0);
});

void test('invocation-local indexes preserve first-match ownership and reflect mutable next calls', () => {
	const clips = [{ id: 'x', value: 1 }, { id: 'x', value: 2 }];
	assert.equal(firstById(clips).get('x')?.value, 1);
	clips[0]!.value = 3;
	assert.equal(firstById(clips).get('x')?.value, 3);
	const tracks = [{ id: 'first', clipIds: ['x'] }, { id: 'second', clipIds: ['x'] }];
	assert.equal(clipOwnerIndex(tracks).get('x')?.id, 'first');
	tracks[0]!.clipIds = [];
	assert.equal(clipOwnerIndex(tracks).get('x')?.id, 'second');
});

void test('completed frame prefix matches reductions at every boundary without later entry reads', () => {
	let reads = 0;
	const entries = Array.from({ length: 1000 }, (_, index) => ({ get endFrame() { reads += 1; return Math.floor(index / 2) * 10; }, frames: index % 7 }));
	const sumAt = createCompletedFrameSum(entries);
	reads = 0;
	for (const frame of [-1, 0, 9, 10, 3000, 4990, 5000]) {
		const expected = entries.reduce((sum, entry) => sum + (entry.endFrame <= frame ? entry.frames : 0), 0);
		const before = reads;
		assert.equal(sumAt(frame), expected);
		assert.equal(reads, before);
	}
});
