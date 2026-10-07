/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { canJoinClips, groupClips, joinClips, ungroupClips } from '../src/common/editor/commands/clip-link-runtime.js';
import { commandFixture, countArrayReads, countPropertyReads } from './helpers/round3-command-fixtures.ts';

void test('group and ungroup share first-match reads and replacement slots across the selection', context => {
	for (const operation of ['group', 'ungroup']) {
		const project = commandFixture();
		const ids = project.clips.map(clip => clip.id);
		const { array, reads } = countArrayReads(project.clips);
		project.clips = array;
		if (operation === 'group') groupClips(project, ids, 'group');
		else ungroupClips(project, ids);
		context.diagnostic(`120-clip ${operation}: ${String(reads())} identity reads`);
		assert.ok(reads() <= 120 * 5, String(reads()));
		assert.ok(project.clips.every(clip => clip.groupId === (operation === 'group' ? 'group' : null)));
	}
});

void test('join preflight resolves selection and owners once while retaining exact diagnostics', context => {
	for (const property of ['identity', 'membership']) {
		const project = commandFixture(120, 120);
		// All selected clips share the same first owner, after an unrelated prefix.
		const ids = project.clips.map(clip => clip.id);
		for (let index = 0; index < project.tracks.length - 1; index += 1) project.tracks[index]!.clipIds = [];
		project.tracks.at(-1)!.clipIds = ids;
		for (let index = 0; index < project.clips.length; index += 1) project.clips[index]!.timelineStartFrame = index * 20;
		const reads = property === 'identity' ? countPropertyReads(project.clips, 'id') : countPropertyReads(project.tracks, 'clipIds');
		assert.equal(canJoinClips(project, ids), true);
		context.diagnostic(`120-clip join ${property}: ${String(reads())} reads`);
		assert.ok(reads() <= 120 * 8, String(reads()));
	}
	const missing = commandFixture(2);
	assert.throws(() => joinClips(missing, ['clip-0', 'missing']), { name: 'ReferenceError', message: 'Unknown clip: missing.' });
	missing.tracks[0]!.clipIds = ['clip-0'];
	assert.throws(() => joinClips(missing, ['clip-0', 'clip-1']), { name: 'ReferenceError', message: 'Clip clip-1 is not assigned to a track.' });
});

void test('linked join preflight indexes A/V members rather than filtering the document per participant', context => {
	const project = commandFixture(120, 2);
	project.tracks[0]!.type = 'video';
	project.tracks[0]!.laneGroupId = 'lane';
	project.tracks[1]!.laneGroupId = 'lane';
	for (let index = 0; index < project.clips.length; index += 1) {
		const clip = project.clips[index]!;
		clip.kind = index % 2 ? 'audio' : 'video';
		clip.timelineStartFrame = Math.floor(index / 2) * 20;
		clip.sourceStartFrame = Math.floor(index / 2) * 20;
		clip.avLinkId = `pair-${String(Math.floor(index / 2))}`;
	}
	const ids = project.clips.map(clip => clip.id);
	const reads = countPropertyReads(project.clips, 'avLinkId');
	assert.equal(canJoinClips(project, ids), true);
	context.diagnostic(`120 linked join participants: ${String(reads())} relationship reads`);
	assert.ok(reads() <= 120 * 8, String(reads()));
});

void test('join sorts selection once and publishes survivors in one pass', context => {
	const project = commandFixture();
	project.clips[1]!.timelineStartFrame = 20;
	const originalClips = project.clips;
	const originalSort = Array.prototype.sort;
	const originalFilter = Array.prototype.filter;
	let selectionSorts = 0;
	let publicationFilters = 0;
	Array.prototype.sort = function (compare) {
		if (this.length && Object.hasOwn(this[0], 'timelineStartFrame')) selectionSorts += 1;
		return originalSort.call(this, compare);
	};
	Array.prototype.filter = function (predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg: unknown) {
		if (this === originalClips) publicationFilters += 1;
		return originalFilter.call(this, predicate, thisArg);
	};
	try { joinClips(project, ['clip-1', 'clip-0']); } finally {
		Array.prototype.sort = originalSort;
		Array.prototype.filter = originalFilter;
	}
	context.diagnostic(`${String(selectionSorts)} selection sorts; ${String(publicationFilters)} intermediate publication filters`);
	assert.equal(selectionSorts, 1);
	assert.equal(publicationFilters, 0);
	assert.equal(project.clips.length, 119);
	assert.equal(project.clips[0]!.durationFrames, 40);
	assert.deepEqual(project.tracks[0]!.clipIds.slice(0, 2), ['clip-0', 'clip-2']);
});

void test('group slot updates preserve first duplicates and earlier writes before an unknown target', () => {
	const project = commandFixture(3);
	project.clips[2]!.id = 'clip-0';
	const duplicate = project.clips[2];
	assert.throws(() => groupClips(project, ['clip-0', 'missing'], 'group'), { name: 'ReferenceError', message: 'Unknown clip: missing.' });
	assert.equal(project.clips[0]!.groupId, 'group');
	assert.equal(project.clips[2], duplicate);
	assert.equal(project.clips[2]!.groupId, null);
	ungroupClips(project, ['clip-0']);
	assert.equal(project.clips[0]!.groupId, null);
});

void test('small command selections stop indexing before unrelated clip and track tails', () => {
	const grouped = commandFixture();
	const tail = grouped.clips.slice(2);
	const reads = countPropertyReads(tail, 'id');
	grouped.clips.splice(2, tail.length, ...tail);
	groupClips(grouped, ['clip-0', 'clip-1'], 'group');
	assert.equal(reads(), 0);
	assert.throws(() => ungroupClips(grouped, []), { name: 'TypeError', message: 'clipIds must be a non-empty array.' });
	assert.equal(reads(), 0);
	const joined = commandFixture(120, 120);
	joined.tracks[0]!.clipIds.push('clip-1');
	joined.tracks[1]!.clipIds = [];
	joined.clips[1]!.timelineStartFrame = 20;
	const tracks = joined.tracks.slice(1);
	const membershipReads = countPropertyReads(tracks, 'clipIds');
	joined.tracks.splice(1, tracks.length, ...tracks);
	assert.equal(canJoinClips(joined, ['clip-1', 'clip-0']), true);
	assert.equal(membershipReads(), 0);
});
