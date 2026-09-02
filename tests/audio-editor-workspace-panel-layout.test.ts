/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION,
	createAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';
import {
	activateWorkspacePanelTab,
	canonicalizeWorkspacePanelGroups,
	groupWorkspacePanelEntries,
	placeWorkspacePanel,
	setWorkspacePanelDockExtent,
	setWorkspacePanelFrameSize,
	setWorkspacePanelVisibility,
	type WorkspacePanelDock,
	type WorkspacePanelPreference,
} from '../src/common/editor/workspace-panel-layout.ts';

interface Panel extends WorkspacePanelPreference {
	readonly size: number;
}

function panel(
	dock: 'left' | 'right' | 'bottom' | 'floating',
	order: number,
	changes: Partial<Panel> = {},
): Panel {
	return { visible: true, dock, order, size: 320, ...changes };
}

test('panel groups normalize to one dock, contiguous order, and one deterministic active tab', () => {
	const normalized = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { size: 280, width: 360, tabGroup: 'inspectors', tabActive: true }),
		effects: panel('right', 1),
		labels: panel('right', 2, { size: 440, width: 520, tabGroup: 'inspectors', tabActive: true }),
		metadata: panel('left', 0, { tabGroup: 'inspectors', tabActive: true }),
	});

	assert.deepEqual(
		Object.fromEntries(Object.entries(normalized).map(([id, entry]) => [id, {
			dock: entry.dock,
			order: entry.order,
			tabGroup: entry.tabGroup,
			tabActive: entry.tabActive,
		}])),
		{
			history: { dock: 'right', order: 0, tabGroup: 'inspectors', tabActive: true },
			effects: { dock: 'right', order: 2, tabGroup: undefined, tabActive: undefined },
			labels: { dock: 'right', order: 1, tabGroup: 'inspectors', tabActive: false },
			metadata: { dock: 'left', order: 0, tabGroup: undefined, tabActive: undefined },
		},
	);
	assert.deepEqual(
		[normalized.history, normalized.labels].map(({ size, width }) => ({ size, width })),
		[{ size: 280, width: 360 }, { size: 280, width: 360 }],
	);
});

test('ordered panel grouping falls back when the persisted active member was filtered out', () => {
	const groups = groupWorkspacePanelEntries([
		['history', panel('right', 0, { tabGroup: 'inspectors', tabActive: false })],
		['labels', panel('right', 1, { tabGroup: 'inspectors', tabActive: false })],
		['effects', panel('right', 2)],
	] as const);

	assert.deepEqual(groups.map((group) => ({
		id: group.id,
		panelIds: group.entries.map(([panelId]) => panelId),
		activePanelId: group.activePanelId,
	})), [
		{ id: 'inspectors', panelIds: ['history', 'labels'], activePanelId: 'history' },
		{ id: 'effects', panelIds: ['effects'], activePanelId: 'effects' },
	]);
});

test('schema-v1 preferences preserve valid tab groups without decorating singleton panels', () => {
	const preferences = createAudioEditorPreferencesV1({
		workspace: {
			panels: {
				history: panel('right', 0, { tabGroup: 'inspectors', tabActive: false }),
				labels: panel('right', 1, { tabGroup: 'inspectors', tabActive: true }),
				effects: panel('right', 2),
			},
		},
	});

	assert.equal(preferences.schemaVersion, AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION);
	assert.equal(preferences.schemaVersion, 1);
	assert.deepEqual(
		{
			history: {
				tabGroup: preferences.workspace.panels.history?.tabGroup,
				tabActive: preferences.workspace.panels.history?.tabActive,
			},
			labels: {
				tabGroup: preferences.workspace.panels.labels?.tabGroup,
				tabActive: preferences.workspace.panels.labels?.tabActive,
			},
			effects: {
				tabGroup: preferences.workspace.panels.effects?.tabGroup,
				tabActive: preferences.workspace.panels.effects?.tabActive,
			},
		},
		{
			history: { tabGroup: 'inspectors', tabActive: false },
			labels: { tabGroup: 'inspectors', tabActive: true },
			effects: { tabGroup: undefined, tabActive: undefined },
		},
	);
	assert.throws(
		() => createAudioEditorPreferencesV1({ workspace: { panels: { history: { tabGroup: '' } } } }),
		/workspace\.panels\.history\.tabGroup/u,
	);
	assert.throws(
		() => createAudioEditorPreferencesV1({ workspace: { panels: { history: { tabGroup: 'inspectors', tabActive: 'yes' } } } }),
		/workspace\.panels\.history\.tabActive/u,
	);
});

test('tab placement appends and activates one panel without moving the rest of its former group', () => {
	let panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { size: 280, width: 360, tabGroup: 'inspectors', tabActive: true }),
		labels: panel('right', 1, { tabGroup: 'inspectors', tabActive: false }),
		effects: panel('right', 2, { size: 460, width: 540 }),
		mixer: panel('bottom', 0),
	});

	panels = placeWorkspacePanel(panels, 'effects', { kind: 'tab', targetPanelId: 'history' });
	assert.deepEqual(
		['history', 'labels', 'effects'].map((id) => ({
			id,
			order: panels[id]?.order,
			tabGroup: panels[id]?.tabGroup,
			tabActive: panels[id]?.tabActive,
		})),
		[
			{ id: 'history', order: 0, tabGroup: 'inspectors', tabActive: false },
			{ id: 'labels', order: 1, tabGroup: 'inspectors', tabActive: false },
			{ id: 'effects', order: 2, tabGroup: 'inspectors', tabActive: true },
		],
	);
	assert.deepEqual(
		{ size: panels.effects?.size, width: panels.effects?.width },
		{ size: 280, width: 360 },
	);

	panels = placeWorkspacePanel(panels, 'labels', { kind: 'after', targetPanelId: 'effects' });
	assert.deepEqual(
		['history', 'effects', 'labels'].map((id) => ({
			id,
			order: panels[id]?.order,
			tabGroup: panels[id]?.tabGroup,
			tabActive: panels[id]?.tabActive,
		})),
		[
			{ id: 'history', order: 0, tabGroup: 'inspectors', tabActive: false },
			{ id: 'effects', order: 1, tabGroup: 'inspectors', tabActive: true },
			{ id: 'labels', order: 2, tabGroup: undefined, tabActive: undefined },
		],
	);
});

test('new tab groups use a collision-free ID when the target panel ID already names another group', () => {
	const panels = canonicalizeWorkspacePanelGroups({
		labels: panel('left', 0, { tabGroup: 'history', tabActive: true }),
		metadata: panel('left', 1, { tabGroup: 'history', tabActive: false }),
		history: panel('right', 0),
		effects: panel('right', 1),
	});
	const grouped = placeWorkspacePanel(panels, 'effects', { kind: 'tab', targetPanelId: 'history' });

	assert.equal(grouped.labels?.tabGroup, 'history-2');
	assert.equal(grouped.metadata?.tabGroup, 'history-2');
	assert.equal(grouped.history?.tabGroup, 'history');
	assert.equal(grouped.effects?.tabGroup, 'history');
});

test('detaching a group anchor renames the remaining group away from its new singleton', () => {
	const panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { tabGroup: 'history', tabActive: true }),
		labels: panel('right', 1, { tabGroup: 'history', tabActive: false }),
		metadata: panel('right', 2, { tabGroup: 'history', tabActive: false }),
		effects: panel('right', 3),
	});
	const detached = placeWorkspacePanel(panels, 'history', { kind: 'before', targetPanelId: 'effects' });
	const groups = groupWorkspacePanelEntries(Object.entries(detached)
		.sort((left, right) => left[1].order - right[1].order));

	assert.equal(detached.history?.tabGroup, undefined);
	assert.equal(detached.labels?.tabGroup, 'history-2');
	assert.equal(detached.metadata?.tabGroup, 'history-2');
	assert.equal(new Set(groups.map(({ id }) => id)).size, groups.length);
});

test('dock placement uses visible group indexes and always creates a standalone group', () => {
	const panels = canonicalizeWorkspacePanelGroups({
		hidden: panel('left', 0, { visible: false }),
		history: panel('left', 1, { width: 444 }),
		labels: panel('left', 2),
		effects: panel('right', 0, { width: 360 }),
	});
	const moved = placeWorkspacePanel(panels, 'effects', { kind: 'dock', dock: 'left', groupIndex: 1 });

	assert.deepEqual(
		Object.entries(moved)
			.filter(([, entry]) => entry.dock === 'left')
			.sort((left, right) => left[1].order - right[1].order)
			.map(([id]) => id),
		['hidden', 'history', 'effects', 'labels'],
	);
	assert.equal(moved.effects?.tabGroup, undefined);
	assert.equal(moved.effects?.tabActive, undefined);
	assert.equal(moved.effects?.width, 444, 'the moved panel inherits the destination side-dock width');
});

test('split placement inherits only the destination dock shared extent', () => {
	const panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { size: 280, width: 444 }),
		metadata: panel('left', 0, { size: 360, width: 320 }),
		mixer: panel('bottom', 0, { size: 512, width: 700 }),
	});
	const side = placeWorkspacePanel(panels, 'metadata', { kind: 'before', targetPanelId: 'history' });
	assert.deepEqual(
		{ size: side.metadata?.size, width: side.metadata?.width },
		{ size: 360, width: 444 },
	);
	const bottom = placeWorkspacePanel(side, 'metadata', { kind: 'after', targetPanelId: 'mixer' });
	assert.deepEqual(
		{ size: bottom.metadata?.size, width: bottom.metadata?.width },
		{ size: 512, width: 444 },
	);
});

test('group visibility selects a visible neighbor and reopening selects the restored tab', () => {
	let panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { tabGroup: 'inspectors', tabActive: true }),
		labels: panel('right', 1, { tabGroup: 'inspectors', tabActive: false }),
		metadata: panel('right', 2, { tabGroup: 'inspectors', tabActive: false }),
	});

	panels = setWorkspacePanelVisibility(panels, 'history', false);
	assert.equal(panels.history?.visible, false);
	assert.equal(panels.labels?.tabActive, true);
	assert.equal(panels.metadata?.tabActive, false);

	panels = setWorkspacePanelVisibility(panels, 'history', true);
	assert.equal(panels.history?.visible, true);
	assert.equal(panels.history?.tabActive, true);
	assert.equal(panels.labels?.tabActive, false);
});

test('frame and dock resizing update every persisted member in one layout mutation', () => {
	let panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { width: 360, tabGroup: 'inspectors', tabActive: true }),
		labels: panel('right', 1, { width: 360, tabGroup: 'inspectors', tabActive: false }),
		effects: panel('right', 2, { width: 360 }),
		mixer: panel('bottom', 0, { size: 420 }),
	});

	panels = setWorkspacePanelFrameSize(panels, 'history', 480);
	assert.deepEqual(
		[panels.history?.size, panels.labels?.size, panels.effects?.size],
		[480, 480, 320],
	);
	panels = setWorkspacePanelDockExtent(panels, 'right', { width: 444 });
	assert.deepEqual(
		[panels.history?.width, panels.labels?.width, panels.effects?.width],
		[444, 444, 444],
	);
	panels = setWorkspacePanelDockExtent(panels, 'bottom', { size: 512 });
	assert.equal(panels.mixer?.size, 512);
	assert.throws(() => setWorkspacePanelFrameSize(panels, 'history', 20), /between 80 and 4096/u);
	assert.throws(() => setWorkspacePanelDockExtent(panels, 'floating', { width: 400 }), /Floating/u);
});

test('activation rejects hidden tabs and selects a visible member atomically', () => {
	const panels = canonicalizeWorkspacePanelGroups({
		history: panel('right', 0, { tabGroup: 'inspectors', tabActive: true }),
		labels: panel('right', 1, { tabGroup: 'inspectors', tabActive: false }),
		metadata: panel('right', 2, { visible: false, tabGroup: 'inspectors', tabActive: false }),
	});
	const activated = activateWorkspacePanelTab(panels, 'labels');

	assert.equal(activated.history?.tabActive, false);
	assert.equal(activated.labels?.tabActive, true);
	assert.throws(() => activateWorkspacePanelTab(panels, 'metadata'), /visible/u);
});

test('panel placement rejects missing targets, unsupported docks, and floating tab groups', () => {
	const panels = {
		history: panel('right', 0),
		effects: panel('right', 1),
		mixer: panel('floating', 0),
	};

	assert.throws(
		() => placeWorkspacePanel(panels, 'history', { kind: 'tab', targetPanelId: 'missing' }),
		/Panel missing/u,
	);
	assert.throws(
		() => placeWorkspacePanel(panels, 'history', { kind: 'dock', dock: 'top' as WorkspacePanelDock, groupIndex: 0 }),
		/unsupported dock/u,
	);
	assert.throws(
		() => placeWorkspacePanel(panels, 'history', { kind: 'tab', targetPanelId: 'mixer' }),
		/Floating panels cannot be tabbed/u,
	);
});
