/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAvLinkedClipIds, collectLinkedTrackRippleTargets, deleteRange, keepRange, prepareRangeDeleteCommand, processTrackRange, replaceRange } from '../src/common/editor/commands/range-runtime.js';
import { commandFixture, countPropertyReads } from './helpers/round3-command-fixtures.ts';

void test('A/V range seeds resolve through one first-match index and retain duplicate output order', context => {
	const project = commandFixture();
	const reads = countPropertyReads(project.clips, 'id');
	assert.deepEqual(collectAvLinkedClipIds(project, project.tracks[0]!.clipIds), project.tracks[0]!.clipIds);
	context.diagnostic(`120 A/V-only range seeds: ${String(reads())} identity reads`);
	assert.ok(reads() <= 120 * 6, String(reads()));
	const mutable = commandFixture(3);
	mutable.clips[0]!.avLinkId = 'first';
	mutable.clips[1]!.avLinkId = 'first';
	mutable.clips[2]!.id = 'clip-0';
	mutable.clips[2]!.avLinkId = 'second';
	assert.deepEqual(collectAvLinkedClipIds(mutable, ['clip-0', 'missing']), ['clip-0', 'clip-1', 'clip-0']);
	mutable.clips[0]!.avLinkId = null;
	assert.deepEqual(collectAvLinkedClipIds(mutable, ['clip-0']), ['clip-0', 'clip-0']);
});

void test('linked-track ripple visits track memberships, A/V relationships and owners once per closure', context => {
	const count = 80;
	const project = commandFixture(count * 2, count);
	for (let index = 0; index < count - 1; index += 1) {
		project.clips[index]!.avLinkId = `link-${String(index)}`;
		project.clips[index + count + 1]!.avLinkId = `link-${String(index)}`;
	}
	const membershipReads = countPropertyReads(project.tracks, 'clipIds');
	const linkReads = countPropertyReads(project.clips, 'avLinkId');
	const result = collectLinkedTrackRippleTargets(project, ['track-0']);
	assert.deepEqual(result.trackIds, project.tracks.map(track => track.id));
	assert.deepEqual(result.clipIds, project.clips.map(clip => clip.id));
	context.diagnostic(`80 linked tracks: ${String(membershipReads())} membership reads, ${String(linkReads())} relationship reads`);
	assert.ok(membershipReads() <= count * 7, String(membershipReads()));
	assert.ok(linkReads() <= count * 12, String(linkReads()));
});

void test('range editing resolves dense track material without per-clip project searches', context => {
	for (const operation of ['process', 'keep', 'replace']) {
		const project = commandFixture();
		const reads = countPropertyReads(project.clips, 'id');
		if (operation === 'process') processTrackRange(project, project.tracks[0], { startFrame: 20_000, endFrame: 20_100, durationFrames: 100 }, 'none', {});
		if (operation === 'keep') keepRange(project, { startFrame: 0, endFrame: 20_000, trackIds: ['track-0'] });
		if (operation === 'replace') replaceRange(project, { startFrame: 20_000, endFrame: 20_100, trackId: 'track-0', clipId: 'replacement', source: { id: 'replacement-source', storageKey: 'replacement-source', frameCount: 20, channelCount: 1 } });
		context.diagnostic(`${operation}: ${String(reads())} identity reads for 120 clips`);
		assert.ok(reads() <= 120 * 12, `${operation}: ${String(reads())}`);
		assert.equal(project.clips.length, operation === 'replace' ? 121 : 120);
	}
});

void test('range delete shares requested track resolution across staging and publication', context => {
	const project = commandFixture(120, 120);
	const command = prepareRangeDeleteCommand(project, { startFrame: 20_000, endFrame: 20_100, rippleMode: 'track' });
	const reads = countPropertyReads(project.tracks, 'id');
	deleteRange(project, command, 'track');
	context.diagnostic(`120 range tracks: ${String(reads())} track identity reads`);
	assert.ok(reads() <= 120 * 12, String(reads()));
});

void test('range indexes preserve missing affected diagnostics and malformed closure compatibility', () => {
	for (const operation of ['process', 'keep', 'replace']) {
		const project = commandFixture(2);
		project.tracks[0]!.clipIds.push('missing');
		const action = (): void => {
			if (operation === 'process') processTrackRange(project, project.tracks[0], { startFrame: 0, endFrame: 20, durationFrames: 20 }, 'none', {});
			if (operation === 'keep') keepRange(project, { startFrame: 0, endFrame: 20, trackIds: ['track-0'] });
			if (operation === 'replace') replaceRange(project, { startFrame: 0, endFrame: 20, trackId: 'track-0', clipId: 'replacement', source: { id: 'new', storageKey: 'new', frameCount: 20, channelCount: 1 } });
		};
		assert.throws(action, { name: 'ReferenceError', message: 'Unknown clip: missing.' });
	}
	const project = commandFixture(3, 3);
	project.tracks[2]!.id = 'track-0';
	assert.deepEqual(collectLinkedTrackRippleTargets(project, ['track-0']).trackIds, ['track-0', 'track-0']);
	project.tracks[0]!.clipIds = [];
	project.clips[2]!.avLinkId = 'pair';
	project.clips[0]!.avLinkId = 'pair';
	assert.throws(() => collectLinkedTrackRippleTargets(project, ['track-0']), { name: 'ReferenceError', message: 'Clip clip-0 is not assigned to a track.' });
});
