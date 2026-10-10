/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackStructuralOperationMenuModel } from '../src/common/editor/ui/track-structural-operation-menu-model.ts';

const copy = {
	muteAllTracks: 'Mute all', unmuteAllTracks: 'Unmute all',
	alignTracks: 'Align content', alignEndToEnd: 'End to end', alignTogether: 'Together',
	sortTracks: 'Sort', sortByTime: 'Time', sortByName: 'Name',
};
interface Track { readonly id: string; readonly locked?: boolean; readonly laneGroupId?: string | null }
interface Node { readonly kind: 'track' | 'folder'; readonly id: string; readonly parentFolderId: string | null }
function menus(tracks: readonly Track[], selectedTrackIds: readonly string[], trackNodes: readonly Node[] = []) {
	const options = { copy, editingBlocked: false, hasTracks: true, hasAlignmentTarget: true,
		project: { tracks, sequences: [{ trackNodes }] }, selectedTrackIds };
	return createTrackStructuralOperationMenuModel(options);
}
function alignmentDisabled(model: ReturnType<typeof menus>): boolean {
	return model.alignMenu.items?.every(item => item.disabled === true) === true;
}
function sortingDisabled(model: ReturnType<typeof menus>): boolean {
	return model.sortMenu.items?.every(item => item.disabled === true) === true;
}

test('unlocked structural menus and global mute controls remain available', () => {
	const model = menus([{ id: 'a' }, { id: 'b' }], ['a']);
	assert.equal(alignmentDisabled(model), false);
	assert.equal(sortingDisabled(model), false);
	assert.equal(model.muteItems.some(item => item.disabled), false);
});
test('a selected locked track suspends global alignment and sorting, preserving mute', () => {
	const model = menus([{ id: 'a', locked: true }, { id: 'b' }], ['a']);
	assert.equal(alignmentDisabled(model), true);
	assert.equal(sortingDisabled(model), true);
	assert.equal(model.muteItems.some(item => item.disabled), false);
});
test('a lock outside the alignment target blocks global sort and keeps alignment available', () => {
	const model = menus([{ id: 'a' }, { id: 'b', locked: true }], ['a']);
	assert.equal(alignmentDisabled(model), false);
	assert.equal(sortingDisabled(model), true);
});
test('all explicit alignment targets participate in lock admission', () => {
	assert.equal(alignmentDisabled(menus([{ id: 'a' }, { id: 'b', locked: true }], ['a', 'b'])), true);
});
test('selecting the unlocked half of a linked lane pair respects its locked partner', () => {
	assert.equal(alignmentDisabled(menus([
		{ id: 'picture', laneGroupId: 'pair' }, { id: 'sound', laneGroupId: 'pair', locked: true },
	], ['picture'])), true);
});
const folderNodes: readonly Node[] = [
	{ id: 'root', kind: 'folder', parentFolderId: null },
	{ id: 'a', kind: 'track', parentFolderId: 'root' },
	{ id: 'nested', kind: 'folder', parentFolderId: 'root' },
	{ id: 'b', kind: 'track', parentFolderId: 'nested' },
	{ id: 'other', kind: 'track', parentFolderId: null },
];
test('a selected folder descendant respects another locked descendant in its timing block', () => {
	assert.equal(alignmentDisabled(menus([
		{ id: 'a' }, { id: 'b', locked: true }, { id: 'other' },
	], ['a'], folderNodes)), true);
});
test('a different root block remains alignable beside a locked folder', () => {
	assert.equal(alignmentDisabled(menus([
		{ id: 'a' }, { id: 'b', locked: true }, { id: 'other' },
	], ['other'], folderNodes)), false);
});
