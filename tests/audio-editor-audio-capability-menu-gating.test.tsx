/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

// The overflow model reaches a JSX helper compiled against the classic runtime,
// which expects React as a global. Publish it before the module graph loads.
(globalThis as unknown as { React: unknown }).React = React;

/**
 * A surface offers a command the product can actually run.
 *
 * Channel layout, reverse, normalize, and pitch/speed are audio-effect work,
 * and their handlers refuse outright on a product without that capability. Two
 * surfaces gated on it — the application menu and the clip properties dialog —
 * and their siblings did not: the track control panel's overflow menu and the
 * timeline's clip context menu offered the same commands enabled on
 * Framescaper, so choosing one produced "Framescaper does not support
 * audioEffects" instead of an edit.
 */

interface MenuItem {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
}

const AUDIO_ONLY_TRACK_ITEMS = ['track-channels'];

// Sample rate and sample format are clip properties, not track properties, and
// the clip properties dialog owns them; the track overflow menu must not carry
// them back.
const CLIP_OWNED_TRACK_ITEMS = ['track-rate', 'track-format'];

test('the track overflow menu offers audio-only commands only where they run', async () => {
	const createTimelineMenuModel = await loadTimelineMenuModel();

	const withCapability = trackOverflowIds(createTimelineMenuModel, { audioEffects: true });
	for (const id of AUDIO_ONLY_TRACK_ITEMS) {
		assert.ok(withCapability.includes(id), `${id} belongs on a product that runs it`);
	}

	const withoutCapability = trackOverflowIds(createTimelineMenuModel, { audioEffects: false });
	for (const id of AUDIO_ONLY_TRACK_ITEMS) {
		assert.equal(withoutCapability.includes(id), false, `${id} would refuse on this product`);
	}
	// The commands that do not depend on the capability stay where they were.
	assert.ok(withoutCapability.includes('track-lock-toggle'));
	for (const id of CLIP_OWNED_TRACK_ITEMS) {
		assert.equal(withCapability.includes(id), false, `${id} belongs to the clip, not the track`);
	}
});

test('the clip context menu asks the same question the clip dialog asks', async () => {
	const { audioClipEditUnavailable } = await import(
		'../src/common/editor/ui/timeline/timeline-menu-model.js'
	) as unknown as {
		audioClipEditUnavailable: (clip: unknown, options: unknown) => boolean;
	};
	const clip = { id: 'clip', kind: 'audio' };

	assert.equal(audioClipEditUnavailable(clip, { mutationsBlocked: false, audioEffects: true }), false);
	assert.equal(
		audioClipEditUnavailable(clip, { mutationsBlocked: false, audioEffects: false }),
		true,
		'a product that refuses the command must not offer it',
	);
	assert.equal(audioClipEditUnavailable(clip, { mutationsBlocked: true, audioEffects: true }), true);
	assert.equal(
		audioClipEditUnavailable({ id: 'v', kind: 'video' }, { mutationsBlocked: false, audioEffects: true }),
		true,
	);
	assert.equal(audioClipEditUnavailable(null, { mutationsBlocked: false, audioEffects: true }), true);
});

async function loadTimelineMenuModel() {
	const module = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
	return module.createTimelineMenuModel as (input: unknown) => {
		trackMenuItems: readonly MenuItem[];
	};
}

function trackOverflowIds(
	createTimelineMenuModel: (input: unknown) => { trackMenuItems: readonly MenuItem[] },
	capabilities: Readonly<Record<string, boolean>>,
): readonly string[] {
	const model = createTimelineMenuModel(overflowInput(capabilities));
	return model.trackMenuItems.map((item) => String(item?.id ?? ''));
}

function overflowInput(capabilities: Readonly<Record<string, boolean>>) {
	const track = {
		id: 'audio-track', type: 'audio', locked: false, clipIds: [], hidden: false, effects: [],
	};
	return {
		controller: { actions: { track: { update: () => undefined } } },
		snapshot: { capabilities },
		locale: 'en',
		copy: copyValues(),
		showArmControls: false,
		onToggleArmControls: () => undefined,
		mutationsBlocked: false,
		state: {
			trackMenu: { trackId: track.id }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: null, setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined, loopPreview: null,
		},
		model: {
			project: {
				id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [track],
				selection: null, loop: { enabled: false }, trackFolders: [],
			},
			sampleRate: 48_000,
		},
		menuActions: { run: (handler: () => unknown) => handler() },
		onOpenSurface: () => undefined,
		productId: capabilities.audioEffects === false ? 'framescaper' : 'soundscaper',
		capabilities,
	} as unknown;
}

function copyValues(): object {
	return new Proxy({}, {
		get(_target, property) { return String(property); },
	});
}
