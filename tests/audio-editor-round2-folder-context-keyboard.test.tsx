/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TrackFolderRow } from '../src/common/editor/ui/timeline/TrackFolderRow.jsx';
import type { TrackFolderRowUiModel, TrackListRowPlan } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const row: TrackFolderRowUiModel = {
	id: 'folder', sequenceId: 'sequence', name: 'Folder', parentFolderId: null,
	level: 1, posInSet: 1, setSize: 1, collapsed: false, hidden: false, mute: false,
	solo: false, hasAudioDescendant: true, rowHidden: false, domId: 'folder-row',
};
const plan: TrackListRowPlan = {
	hasFolders: true, entries: [{ kind: 'folder', row }], folderRows: [row], treeOwnedIds: row.domId,
};

for (const key of ['ContextMenu', 'F10', 'ArrowRight', 'modified-F10', 'descendant'] as const) {
	test(`folder row routes ${key} without stealing tree or descendant keys`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const menuCalls: { folderId: string; position: { x: number; y: number } }[] = [];
		let treeCalls = 0;
		let prevented = 0;
		let stopped = 0;
		try {
			await act(async () => root.render(<TrackFolderRow row={row} plan={plan} copy={{}}
				blocked={false} selected={true} activeFolderId={row.id} panelWidth={180} editing={false}
				onSelect={() => {}} onKeyDown={() => { treeCalls += 1; }} onToggleCollapsed={() => {}}
				onSetFlag={() => {}} onRename={() => {}} onDropNode={() => {}}
				onMenu={(folderId: string, position: { x: number; y: number }) => menuCalls.push({ folderId, position })} />));
			const folder = dom.one('[data-track-folder-row]');
			folder.getBoundingClientRect = () => ({ left: 12, bottom: 34 });
			await act(async () => reactProps(folder).onKeyDown({
				key: key === 'modified-F10' ? 'F10' : key === 'descendant' ? 'ContextMenu' : key,
				shiftKey: key === 'F10' || key === 'modified-F10', ctrlKey: key === 'modified-F10',
				currentTarget: folder, target: key === 'descendant' ? dom.one('button') : folder,
				preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; },
			}));
			const opensMenu = key === 'ContextMenu' || key === 'F10';
			assert.deepEqual(menuCalls, opensMenu ? [{ folderId: row.id, position: { x: 12, y: 34 } }] : []);
			assert.equal(treeCalls, opensMenu ? 0 : 1);
			assert.equal(prevented, opensMenu ? 1 : 0);
			assert.equal(stopped, opensMenu ? 1 : 0);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
