/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

// The overflow model reaches a JSX helper compiled against the classic runtime, which
// expects React as a global. Publish it before the module graph loads.
(globalThis as unknown as { React: unknown }).React = React;

type TimelineMenuModelFactory = (input: unknown) => { trackMenuItems: readonly MenuItem[] };

async function loadTimelineMenuModel(): Promise<TimelineMenuModelFactory> {
	const module = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
	return module.createTimelineMenuModel as TimelineMenuModelFactory;
}

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly onClick?: () => unknown;
}

test('both products compose selected-track Lock and Unlock through the track overflow menu', async () => {
	const createTimelineMenuModel = await loadTimelineMenuModel();
	// Lock is a per-track action, so the track control panel's overflow menu is its
	// surface rather than the application menubar.
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		for (const type of ['audio', 'video', 'label'] as const) {
			for (const locked of [false, true]) {
				const calls: unknown[] = [];
				const item = trackLockOverflowItem(createTimelineMenuModel, overflowInput({
					productId, type, locked, mutationsBlocked: false,
					update: (trackId: string, changes: unknown) => { calls.push({ trackId, changes }); },
				}));
				assert.deepEqual({ id: item.id, label: item.label, disabled: item.disabled }, {
					id: 'track-lock-toggle',
					label: locked ? 'Unlock track' : 'Lock track',
					disabled: false,
				});
				item.onClick?.();
				assert.deepEqual(calls, [{ trackId: `${type}-track`, changes: { locked: !locked } }]);
			}
		}
	}
});

test('blocked editing keeps one disabled track-overflow lock item', async () => {
	const createTimelineMenuModel = await loadTimelineMenuModel();
	const blocked = trackLockOverflowItem(createTimelineMenuModel, overflowInput({
		productId: 'framescaper', type: 'video', locked: true, mutationsBlocked: true,
		update: () => assert.fail('disabled item dispatched'),
	}));
	assert.equal(blocked.label, 'Unlock track');
	assert.equal(blocked.disabled, true);
});

function trackLockOverflowItem(createTimelineMenuModel: TimelineMenuModelFactory, input: unknown): MenuItem {
	const model = createTimelineMenuModel(input);
	const item = model.trackMenuItems.find(({ id }) => id === 'track-lock-toggle');
	assert.ok(item, 'the track overflow menu carries the lock command');
	return item;
}

function overflowInput({ productId, type, locked, mutationsBlocked, update }: Readonly<{
	productId: 'soundscaper' | 'framescaper';
	type: 'audio' | 'video' | 'label';
	locked: boolean;
	mutationsBlocked: boolean;
	update: (trackId: string, changes: unknown) => unknown;
}>) {
	const track = { id: `${type}-track`, type, locked, clipIds: [], hidden: false, effects: [] };
	return {
		controller: { actions: { track: { update } } },
		snapshot: { capabilities: {} },
		locale: 'en',
		copy: copyValues(),
		showArmControls: false,
		onToggleArmControls: () => undefined,
		mutationsBlocked,
		state: { trackMenu: { trackId: track.id }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: null, setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined, loopPreview: null },
		model: {
			project: {
				id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [track],
				selection: null, loop: { enabled: false }, trackFolders: [],
			},
			sampleRate: 48_000,
		},
		menuActions: { run: (handler: () => unknown) => handler() },
		onOpenSurface: () => undefined,
		productId,
		capabilities: {},
	} as unknown;
}

function copyValues(): object {
	return new Proxy({ lockTrack: 'Lock track', unlockTrack: 'Unlock track' }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}
