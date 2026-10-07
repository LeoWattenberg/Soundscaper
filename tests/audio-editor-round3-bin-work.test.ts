/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSourceBinRuntimeHandlers } from '../src/common/editor/commands/project-source-bin-runtime.js';
import { commandFixture, countPropertyReads } from './helpers/round3-command-fixtures.ts';

const handlers = createProjectSourceBinRuntimeHandlers(() => undefined);

void test('moving timeline material to the bin indexes requested IDs and linked item membership once', context => {
	for (const property of ['id', 'avLinkId']) {
		const project = commandFixture();
		for (let index = 0; index < project.clips.length; index += 1) project.clips[index]!.avLinkId = `pair-${String(Math.floor(index / 2))}`;
		const ids = project.clips.map(clip => clip.id);
		const reads = countPropertyReads(project.clips, property);
		handlers['project-bin/move-from-timeline'](project, { clipIds: ids });
		context.diagnostic(`120-clip bin move ${property}: ${String(reads())} reads`);
		assert.ok(reads() <= 120 * 12, String(reads()));
		assert.equal(project.clips.length, 0);
		assert.equal(project.projectBin.clips.length, 120);
		assert.equal(project.projectBin.clips[1]!.binItemId, 'clip-0');
	}
});

void test('bin move retains its selected material instead of filtering it again before normalization', context => {
	const project = commandFixture();
	const originalClips = project.clips;
	const originalFilter = Array.prototype.filter;
	let visits = 0;
	Array.prototype.filter = function (predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg: unknown) {
		if (this === originalClips) visits += this.length;
		return originalFilter.call(this, predicate, thisArg);
	};
	try { handlers['project-bin/move-from-timeline'](project, { clipIds: ['clip-0'] }); }
	finally { Array.prototype.filter = originalFilter; }
	context.diagnostic(`one bin move in 120 clips: ${String(visits)} top-level filter visits`);
	assert.equal(visits, 240);
	assert.equal(project.clips.length, 119);
	assert.equal(project.projectBin.clips[0]!.id, 'clip-0');
});

void test('bin move preserves one-hop selection, authored item order and malformed first identity', () => {
	const project = commandFixture(4);
	project.clips[0]!.groupId = 'group';
	project.clips[1]!.groupId = 'group';
	project.clips[1]!.avLinkId = 'link';
	project.clips[2]!.avLinkId = 'link';
	handlers['project-bin/move-from-timeline'](project, { clipIds: ['clip-0'] });
	assert.deepEqual(project.projectBin.clips.map(clip => clip.id), ['clip-0', 'clip-1']);
	assert.deepEqual(project.clips.map(clip => clip.id), ['clip-2', 'clip-3']);
	assert.equal(project.projectBin.clips[1]!.binItemId, 'clip-1');
	const duplicate = commandFixture(3);
	duplicate.clips[0]!.avLinkId = 'first';
	duplicate.clips[1]!.avLinkId = 'first';
	duplicate.clips[2]!.id = 'clip-0';
	handlers['project-bin/move-from-timeline'](duplicate, { clipIds: ['clip-0'] });
	assert.deepEqual(duplicate.projectBin.clips.map(clip => [clip.id, clip.binItemId]), [['clip-0', 'clip-0'], ['clip-1', 'clip-0'], ['clip-0', 'clip-0']]);
});
