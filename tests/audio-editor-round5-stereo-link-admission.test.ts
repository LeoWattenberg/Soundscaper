/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackSelectionContextMenuItems, type TrackSelectionContextTrack }
	from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const track = (id: string, laneGroupId: string | null = null, width = 1) => ({ id,
	type: 'audio', clipIds: [`${id}-clip`], laneGroupId, width });
const standalone = track('recording'), paired = track('camera', 'camera-lane');
function channelItems(primary: ReturnType<typeof track>, tracks: ReturnType<typeof track>[], blocked = false) {
	const project = { tracks, clips: tracks.map(item => ({ id: item.clipIds[0]!, sourceId: `${item.id}-source` })),
		sources: tracks.map(item => ({ id: `${item.id}-source`, channelCount: item.width })) };
	return createTrackSelectionContextMenuItems({ project, track: primary as TrackSelectionContextTrack,
		copy: ENGLISH_COPY, blocked, audioEffects: true,
		actions: { makeStereo: () => undefined, swapChannels: () => undefined,
			splitStereoLR: () => undefined, splitStereoCenter: () => undefined } }).audio[0]!.items!;
}
for (const primary of [standalone, paired]) test(`Make stereo rejects a paired camera as ${primary.id === 'camera' ? 'primary' : 'only partner'}`, () => {
	assert.equal(channelItems(primary, [standalone, paired]).find(item => item.id === 'track-make-stereo')!.disabled, true);
});
test('a real standalone mono partner keeps Make stereo available despite an unrelated camera', () => {
	const other = track('other');
	assert.equal(channelItems(standalone, [standalone, paired, other]).find(item => item.id === 'track-make-stereo')!.disabled, false);
});
test('stereo primary, same identity, empty and blocked projects remain unavailable', () => {
	const stereo = track('stereo', null, 2), empty = track('empty', null, 0);
	for (const [primary, tracks, blocked] of [
		[standalone, [standalone], false], [stereo, [stereo, standalone], false],
		[empty, [empty, standalone], false], [standalone, [standalone, track('other')], true],
	] as const) assert.equal(channelItems(primary, [...tracks], blocked).find(item => item.id === 'track-make-stereo')!.disabled, true);
});
test('paired genuine stereo retains independently implemented channel-split and swap controls', () => {
	const stereo = track('camera-stereo', 'camera-lane', 2);
	for (const id of ['track-swap-channels', 'track-split-stereo-to-lr', 'track-split-stereo-to-center']) {
		assert.equal(channelItems(stereo, [stereo, standalone]).find(item => item.id === id)!.disabled, false);
	}
});
