/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { createTrackSelectionContextMenuItems } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

interface Track { id: string; type: string; locked: boolean; clipIds: string[]; laneGroupId: string | null }
interface Item { id?: string; disabled?: boolean; label?: unknown; items?: Item[]; onClick?: () => unknown }
const track = (id: string, locked = false, laneGroupId: string | null = null): Track =>
	({ id, type: 'audio', locked, clipIds: [`${id}-clip`], laneGroupId });
function projectFor(tracks: Track[]) {
	return { tracks, clips: tracks.map(item => ({ id: item.clipIds[0]!, sourceId: `${item.id}-source` })),
		sources: tracks.map(item => ({ id: `${item.id}-source`, channelCount: 2 })), trackFolders: [], loop: {} };
}
function channels(primary: Track, tracks: Track[]) {
	return createTrackSelectionContextMenuItems({ project: projectFor(tracks), track: primary,
		copy: ENGLISH_COPY, blocked: false, audioEffects: true,
		actions: { update: () => undefined, makeStereo: () => undefined, swapChannels: () => undefined,
			splitStereoLR: () => undefined, splitStereoCenter: () => undefined } });
}
for (const id of ['track-swap-channels', 'track-split-stereo-to-lr', 'track-split-stereo-to-center']) {
	test(`locked track disables ordinary ${id} without disabling Unlock`, () => {
		const primary = track('recording', true), model = channels(primary, [primary]);
		assert.equal(model.audio[0]!.disabled, true);
		assert.equal(model.audio[0]!.items!.find(item => item.id === id)!.disabled, true);
		assert.equal(model.shared[0]!.disabled, false);
	});
}
test('ordinary unlocked channel operations stay enabled beside an unrelated lock', () => {
	const primary = track('recording'), model = channels(primary, [primary, track('unrelated', true)]);
	assert.equal(model.audio[0]!.disabled, false);
	for (const id of ['track-swap-channels', 'track-split-stereo-to-lr', 'track-split-stereo-to-center']) {
		assert.equal(model.audio[0]!.items!.find(item => item.id === id)!.disabled, false);
	}
});
for (const pairedLock of [false, true]) {
	test(`${pairedLock ? 'paired member' : 'own'} lock disables structural menus and preserves copying`, async () => {
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		try {
			const primary = track('recording', !pairedLock, pairedLock ? 'camera' : null);
			const project = projectFor([primary, track('partner', pairedLock, pairedLock ? 'camera' : null)]);
			const { createTimelineMenuModel } = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
			const { trackMenuItems } = createTimelineMenuModel({
				controller: { actions: { track: { update: () => undefined } } },
				snapshot: { capabilities: {}, preferences: {} }, locale: 'en', copy: ENGLISH_COPY,
				mutationsBlocked: false, showArmControls: false, onToggleArmControls: () => undefined,
				automationControls: undefined, freezeRuntime: undefined, state: { trackMenu: { trackId: primary.id }, waveformRulerState: {},
					setTrackColorMenu: () => undefined, setWaveformRulerState: () => undefined },
				model: { project, sampleRate: 48000 }, menuActions: { run: (operation: () => unknown) => operation() },
				onOpenSurface: () => undefined, productId: 'soundscaper', capabilities: {},
			}) as { trackMenuItems: Item[] };
			const move = trackMenuItems.find(item => item.id === 'move-track')!;
			assert.equal(move.disabled, true);
			assert.ok(move.items!.every(item => item.disabled === true));
			const itemFor = (actionId: string) => trackMenuItems.find(item => React.isValidElement<{ action?: { actionId?: string } }>(item.label)
				&& item.label.props.action?.actionId === actionId)!;
			assert.equal(itemFor('remove-tracks').disabled, true);
			assert.equal(itemFor('duplicate-track').disabled, false);
			assert.equal(trackMenuItems.find(item => item.id === 'track-lock-toggle')!.disabled, false);
		} finally {
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
		}
	});
}


test('Make stereo follows the actual selected partner lock instead of offering a doomed conversion', () => {
	const primary = track('recording'), partner = track('partner', true);
	const project = projectFor([primary, partner]);
	project.sources.forEach(source => { source.channelCount = 1; });
	const model = createTrackSelectionContextMenuItems({ project, track: primary, copy: ENGLISH_COPY,
		blocked: false, audioEffects: true, actions: { makeStereo: () => undefined } });
	assert.equal(model.audio[0]!.items!.find(item => item.id === 'track-make-stereo')!.disabled, true);
});
