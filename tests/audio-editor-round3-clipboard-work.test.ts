/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardDescriptor, pasteClipboard, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { commandFixture, countPropertyReads } from './helpers/round3-command-fixtures.ts';

void test('clipboard descriptors share track, clip, owner and sequence lookups', context => {
	for (const property of ['clip-id', 'track-id', 'membership']) {
		const project = commandFixture(120, 120);
		const reads = property === 'clip-id' ? countPropertyReads(project.clips, 'id')
			: property === 'track-id' ? countPropertyReads(project.tracks, 'id') : countPropertyReads(project.tracks, 'clipIds');
		const clipboard = createClipboardDescriptor(project, { startFrame: 0, endFrame: 20_000 });
		assert.equal(clipboard.tracks.length, 120);
		context.diagnostic(`120-track clipboard ${property}: ${String(reads())} reads`);
		assert.ok(reads() <= 120 * 20, `${property}: ${String(reads())}`);
	}
});

void test('clipboard feature detection reads video kinds once without two concatenated arrays', context => {
	const project = commandFixture();
	const reads = countPropertyReads(project.clips, 'kind');
	const clipboard = createClipboardDescriptor(project, { startFrame: 20_000, endFrame: 20_100, trackIds: [] });
	assert.equal(clipboard.schemaVersion, 4);
	context.diagnostic(`120 unused audio clips: ${String(reads())} feature-kind reads`);
	assert.equal(reads(), 120);
});

void test('reject paste reuses clip admission, source bounds and existing material across additions', context => {
	for (const property of ['clip-id', 'source-id', 'membership']) {
		const project = commandFixture();
		const clipboard = createClipboardDescriptor(project, { startFrame: 0, endFrame: 6000 });
		let nextId = 0;
		const command = preparePasteCommand(clipboard, { atFrame: 20_000 }, () => `pasted-${String(nextId++)}`);
		// A large unrelated source prefix makes source-bound lookups observable.
		project.sources.unshift(...Array.from({ length: 80 }, (_, index) => ({ id: `unused-${String(index)}` })));
		const reads = property === 'clip-id' ? countPropertyReads(project.clips, 'id')
			: property === 'source-id' ? countPropertyReads(project.sources, 'id') : countPropertyReads(project.tracks, 'clipIds');
		pasteClipboard(project, command);
		assert.equal(project.clips.length, 180);
		context.diagnostic(`60-clip reject paste ${property}: ${String(reads())} reads`);
		assert.ok(reads() <= 180 * 8, `${property}: ${String(reads())}`);
	}
});

void test('paste groups pending material per target without scanning additions for every descriptor', context => {
	const project = commandFixture();
	const clipboard = createClipboardDescriptor(project, { startFrame: 0, endFrame: 6000 });
	let nextId = 0;
	const command = preparePasteCommand(clipboard, { atFrame: 20_000 }, () => `pasted-${String(nextId++)}`);
	// Only additions.filter used an object whose track property identifies a pending item.
	const originalFilter = Array.prototype.filter;
	let pendingVisits = 0;
	Array.prototype.filter = function (predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg: unknown) {
		if (this.length && Object.hasOwn(this[0], 'track') && Object.hasOwn(this[0], 'clip')) pendingVisits += this.length;
		return originalFilter.call(this, predicate, thisArg);
	};
	try { pasteClipboard(project, command); } finally { Array.prototype.filter = originalFilter; }
	context.diagnostic(`60-clip paste: ${String(pendingVisits)} pending-filter visits`);
	assert.equal(pendingVisits, 0);
});

void test('insert paste resolves existing dense material once per edited track', context => {
	const project = commandFixture();
	const clipboard = createClipboardDescriptor(project, { startFrame: 0, endFrame: 20 });
	const command = preparePasteCommand(clipboard, { atFrame: 20_000, mode: 'insert-track', project }, () => 'pasted');
	const reads = countPropertyReads(project.clips, 'id');
	pasteClipboard(project, command);
	context.diagnostic(`insert paste with 120 existing clips: ${String(reads())} identity reads`);
	assert.ok(reads() <= 120 * 8, String(reads()));
	assert.equal(project.clips.length, 121);
});

void test('paste keeps pending overlap refusals and first-match malformed identities before publication', () => {
	const project = commandFixture(2);
	const clipboard = createClipboardDescriptor(project, { startFrame: 0, endFrame: 120 });
	(clipboard.tracks[0]!.clips[1]! as Record<string, unknown>).offsetFrame = 0;
	const command = preparePasteCommand(clipboard, { atFrame: 1000 }, (() => { let id = 0; return () => `new-${String(id++)}`; })());
	const before = structuredClone(project);
	assert.throws(() => pasteClipboard(project, command), { name: 'RangeError', message: 'Clip overlaps existing material on track track-0.' });
	assert.deepEqual(project, before);
	const mutable = commandFixture(2);
	const small = createClipboardDescriptor(mutable, { startFrame: 0, endFrame: 20 });
	const duplicate = preparePasteCommand(small, { atFrame: 1000 }, () => 'clip-0');
	assert.throws(() => pasteClipboard(mutable, duplicate), { name: 'RangeError', message: 'Duplicate clip ID: clip-0.' });
	mutable.tracks[0]!.clipIds.push('missing');
	const missing = preparePasteCommand(small, { atFrame: 1000 }, () => 'new');
	assert.throws(() => pasteClipboard(mutable, missing), { name: 'ReferenceError', message: 'Unknown clip: missing.' });
});
