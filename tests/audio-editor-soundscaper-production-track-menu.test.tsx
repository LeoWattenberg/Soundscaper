/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

// The overflow model reaches a JSX helper compiled against the classic runtime,
// which expects React as a global. Publish it before the module graph loads.
(globalThis as unknown as { React: unknown }).React = React;

interface MenuItem {
	readonly id?: unknown;
	readonly checked?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('the track overflow shares automation mode ownership with the production workspace', async () => {
	const { createTimelineMenuModel } = await import(
		'../src/common/editor/ui/timeline/timeline-menu-model.js'
	) as unknown as {
		createTimelineMenuModel(input: unknown): { trackMenuItems: readonly MenuItem[] };
	};
	const runtimeModeCalls: unknown[][] = [];
	const runtimeFreezeCalls: unknown[][] = [];
	const directModeCalls: unknown[][] = [];
	const directFreezeCalls: unknown[][] = [];
	const project = soundscaperProject();
	const model = createTimelineMenuModel({
		controller: {
			actions: {
				track: { update: () => undefined },
				audioAutomation: {
					getSnapshot: () => ({ mode: 'read' }),
					setMode: (mode: string, laneId: string | null) => { directModeCalls.push([mode, laneId]); },
				},
				audioFreeze: Object.fromEntries(['freeze', 'refresh', 'unfreeze', 'commit'].map((operation) => [
					operation, (trackId: string) => { directFreezeCalls.push([operation, trackId]); },
				])),
			},
		},
		snapshot: { capabilities: { audioAutomation: true, audioTrackFreeze: true } },
		locale: 'en',
		copy: copyValues(),
		showArmControls: false,
		onToggleArmControls: () => undefined,
		mutationsBlocked: false,
		state: {
			trackMenu: { trackId: 'voice' }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: null, setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined, loopPreview: null,
		},
		model: { project, sampleRate: 48_000 },
		menuActions: { run: (operation: () => unknown) => operation() },
		onOpenSurface: () => undefined,
		onOpenTrackRate: () => undefined,
		productId: 'soundscaper',
		capabilities: { audioAutomation: true, audioTrackFreeze: true },
		soundscaperProduction: {
			automationMode: 'touch',
			setAutomationMode: (mode: string, laneId: string | null) => {
				runtimeModeCalls.push([mode, laneId]);
			},
			freeze: (operation: string, trackId: string) => { runtimeFreezeCalls.push([operation, trackId]); },
		},
	});

	const automation = requiredItem(model.trackMenuItems, 'soundscaper-automation');
	const modes = requiredItem(automation.items, 'soundscaper-automation-mode');
	assert.equal(requiredItem(modes.items, 'soundscaper-automation-mode-read').checked, false);
	assert.equal(requiredItem(modes.items, 'soundscaper-automation-mode-touch').checked, true,
		'the context menu must draw the same mode as the application menu');

	requiredItem(modes.items, 'soundscaper-automation-mode-write').onClick?.();
	assert.deepEqual(runtimeModeCalls, [['write', 'voice-gain']]);
	assert.deepEqual(directModeCalls, [], 'the context menu must not bypass workspace-owned mode state');

	const freeze = requiredItem(model.trackMenuItems, 'soundscaper-freeze');
	requiredItem(freeze.items, 'soundscaper-freeze-track').onClick?.();
	assert.deepEqual(runtimeFreezeCalls, [['freeze', 'voice']]);
	assert.deepEqual(directFreezeCalls, [], 'freeze progress must invalidate the same workspace runtime');
});

function requiredItem(items: readonly MenuItem[] | undefined, id: string): MenuItem {
	const item = items?.find((candidate) => candidate.id === id);
	assert.ok(item, `Expected menu item ${id}`);
	return item;
}

function soundscaperProject(): Readonly<Record<string, unknown>> {
	return {
		id: 'project', schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48_000,
		sources: [{ id: 'source', sampleRate: 48_000, sampleFormat: 'f32', channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source' }], selection: null, loop: { enabled: false }, trackFolders: [],
		tracks: [{
			id: 'voice', type: 'audio', name: 'Voice', locked: false, hidden: false,
			clipIds: ['clip'], effects: [{ id: 'effect', enabled: true }],
		}],
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'point', position: 0, value: 1 }], segments: [],
		}],
		mixer: { groups: [], sends: [], cues: [], vcas: [], outputs: [], edges: [] },
	};
}

function copyValues(): object {
	return new Proxy({}, {
		get(_target, property) { return String(property); },
	});
}
