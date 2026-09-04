/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document-track-folder-snapshot.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { TrackFolderRow } from '../src/common/editor/ui/timeline/TrackFolderRow.jsx';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

// The menu model reaches a JSX helper compiled against the classic runtime,
// which expects React as a global. Publish it before the module graph loads.
(globalThis as unknown as { React: unknown }).React = React;

type TimelineMenuModelFactory = (input: unknown) => { folderMenuItems: readonly MenuItem[] };

async function loadTimelineMenuModel(): Promise<TimelineMenuModelFactory> {
	const module = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
	return module.createTimelineMenuModel as TimelineMenuModelFactory;
}

interface MenuItem {
	readonly label?: unknown;
	readonly checked?: unknown;
	readonly disabled?: unknown;
	readonly divider?: unknown;
	readonly onClick?: () => unknown;
}

const NOW = '2026-09-04T09:00:00.000Z';

function renderRow(overrides: Record<string, unknown> = {}) {
	const project = folderProject();
	const plan = planTrackListRows(
		createDocumentTrackFolderSnapshot(project),
		project.tracks as readonly { id: string }[],
		project.trackFolders,
	);
	const row = plan.folderRows.find(({ id }) => id === 'band');
	assert.ok(row, 'the plan carries the folder row');
	return renderToStaticMarkup(<TrackFolderRow
		row={row}
		plan={plan}
		copy={ENGLISH_COPY}
		blocked={false}
		selected={false}
		activeFolderId={null}
		panelWidth={240}
		editing={false}
		onSelect={() => undefined}
		onKeyDown={() => undefined}
		onToggleCollapsed={() => undefined}
		onSetFlag={() => undefined}
		onMenu={() => undefined}
		onRename={() => undefined}
		onDropNode={() => undefined}
		{...overrides}
	/>);
}

// Sequential tab navigation is an accessibility profile, so a row that ignores
// it leaves its collapse, mute, solo and hide buttons on -1 in every mode.
test('sequential tab navigation reaches the folder row controls', () => {
	const hierarchical = renderRow();
	assert.equal((hierarchical.match(/tabindex="-1"/giu) ?? []).length, 4);

	const flat = renderRow({ isFlatNavigation: true });
	assert.doesNotMatch(flat, /tabindex="-1"/iu);
	assert.equal(
		(flat.match(/tabindex="0"/giu) ?? []).length,
		5,
		'the treeitem and its four controls are all tabbable',
	);
});

// Under tree navigation the controls stay at -1 by design and the tree keys
// spend their arrows on navigation, so the context menu is the only route left.
test('the folder context menu carries the audibility toggles the row buttons hold', async () => {
	const createTimelineMenuModel = await loadTimelineMenuModel();
	for (const [flag, label] of [
		['mute', 'Mute folder'],
		['solo', 'Solo folder'],
		['hidden', 'Hide folder'],
	] as const) {
		for (const enabled of [false, true]) {
			const updates: unknown[] = [];
			const { folderMenuItems: items } = createTimelineMenuModel(
				folderMenuInput({ [flag]: enabled }, updates),
			);
			const item = items.find((candidate) => candidate.label === label);
			assert.ok(item, `${label} is offered on the folder menu`);
			assert.equal(item.checked, enabled);
			assert.equal(item.disabled, false);
			item.onClick?.();
			assert.deepEqual(updates, [{ folderId: 'band', changes: { [flag]: !enabled } }]);
		}
	}
});

test('blocked editing disables the folder audibility toggles rather than hiding them', async () => {
	const createTimelineMenuModel = await loadTimelineMenuModel();
	const { folderMenuItems: items } = createTimelineMenuModel(folderMenuInput({}, [], true));
	const labels = items.filter(({ divider }) => !divider).map(({ label }) => label);
	assert.deepEqual(labels.slice(2, 5), ['Mute folder', 'Solo folder', 'Hide folder']);
	for (const item of items) assert.notEqual(item.divider ? undefined : item.disabled, false);
});

function folderProject(flags: Record<string, boolean> = {}) {
	return createCurrentAudioEditorProject({
		id: 'folder-audibility',
		title: 'Folder audibility',
		now: NOW,
		primarySequenceId: 'main',
		trackFolders: [{ id: 'band', name: 'Band', ...flags }],
		tracks: [createAudioTrack({ id: 'kick', name: 'Kick' })],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'kick', parentFolderId: 'band' },
			],
		}],
	});
}

function folderMenuInput(
	flags: Record<string, boolean>,
	updates: unknown[],
	mutationsBlocked = false,
) {
	const project = folderProject(flags);
	return {
		controller: {
			actions: {
				trackFolders: {
					update: (folderId: string, changes: unknown) => { updates.push({ folderId, changes }); },
				},
			},
		},
		snapshot: { capabilities: { trackFolders: true }, preferences: { shortcuts: {} } },
		locale: 'en',
		copy: ENGLISH_COPY,
		showArmControls: false,
		onToggleArmControls: () => undefined,
		mutationsBlocked,
		state: {
			trackMenu: { folderId: 'band' },
			outputMenu: null,
			trackColorMenu: null,
			clipMenu: null,
			trackRulerFlyout: null,
			waveformRulerState: null,
			setTrackColorMenu: () => undefined,
			setWaveformRulerState: () => undefined,
			loopPreview: null,
		},
		model: { project, sampleRate: project.sampleRate },
		menuActions: { run: (handler: () => unknown) => handler() },
		onOpenSurface: () => undefined,
		productId: 'soundscaper',
		capabilities: { trackFolders: true },
	} as unknown;
}
