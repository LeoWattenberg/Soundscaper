/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findMenuItem } from './helpers/application-menu-fixture.ts';

import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

interface MenuItem {
	readonly id?: string;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

test('Measure loudness opens the delivery report that receives its result', async () => {
	const dialogs: string[] = [];
	let finishMeasurement!: (report: object) => void;
	const measurement = new Promise<object>((resolve) => { finishMeasurement = resolve; });
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		controller: { actions: { analysis: { measureLoudness: () => measurement } } },
		setDialog: (dialog: string) => { dialogs.push(dialog); },
	})) as readonly MenuItem[];
	const command = findMenuItem(menus, 'measure-loudness');
	assert.ok(command?.onClick);

	const pending = command.onClick();
	assert.deepEqual(dialogs, [], 'the stale report stays hidden while measurement is running');
	finishMeasurement({ subject: { format: 'loudness-measurement' } });
	await pending;

	assert.deepEqual(dialogs, ['delivery-report']);
});

test('Measure loudness leaves the report closed when no result was produced', async () => {
	const dialogs: string[] = [];
	const menus = createWorkspaceApplicationMenus(workspaceInput({
		controller: { actions: { analysis: { measureLoudness: async () => null } } },
		setDialog: (dialog: string) => { dialogs.push(dialog); },
	})) as readonly MenuItem[];
	const command = findMenuItem(menus, 'measure-loudness');
	assert.ok(command?.onClick);

	await command.onClick();

	assert.deepEqual(dialogs, []);
});

function workspaceInput(overrides: Readonly<Record<string, unknown>> = {}) {
	const project = {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] }],
		selection: { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: { audioAnalysis: true }, locale: 'en',
		copy: new Proxy({}, { get: (_target, property) => String(property) }), project,
		snapshot: {
			project, selectedTrackId: 'track-a',
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		controller: { actions: { analysis: { measureLoudness: async () => null } } },
		selectedAudioTrack: project.tracks[0],
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 20,
		projectBinEffectivelyOpen: false, uiFlags: {},
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
		...overrides,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? (() => undefined),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}
