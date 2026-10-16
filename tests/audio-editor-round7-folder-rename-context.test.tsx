/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackFolderRow } from '../src/common/editor/ui/timeline/TrackFolderRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

void test('folder rename retains the native text context menu and its draft', async () => {
	const dom = installReactTestDom();
	const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const root = createRoot(dom.container as unknown as Element);
	const row = { id: 'folder', name: 'Folder', domId: 'folder-row', level: 1, posInSet: 1,
		setSize: 1, rowHidden: false, collapsed: false, parentFolderId: null, hidden: false, mute: false, solo: false };
	const menus: unknown[] = [];
	const noop = () => undefined;
	try {
		await act(async () => root.render(<TrackFolderRow row={row} plan={{ folderRows: [row] }}
			copy={ENGLISH_COPY} blocked={false} selected={true} activeFolderId="folder" panelWidth={180}
			editing={true} onSelect={noop} onKeyDown={noop} onToggleCollapsed={noop} onSetFlag={noop}
			onMenu={(...args: unknown[]) => { menus.push(args); }} onRename={noop} onDropNode={noop} />));
		const folder = dom.one('[data-track-folder-row]');
		const input = dom.one('input');
		input.value = 'Draft';
		let prevented = 0;
		const event = { target: input, currentTarget: folder, clientX: 20, clientY: 40,
			preventDefault: () => { prevented += 1; } };
		await act(async () => { reactProps(folder).onContextMenu?.(event); });
		assert.equal(prevented, 0);
		assert.deepEqual(menus, []);
		assert.equal(input.value, 'Draft');
		await act(async () => { reactProps(folder).onContextMenu?.({ ...event, target: folder }); });
		assert.equal(prevented, 1);
		assert.deepEqual(menus, [['folder', { x: 20, y: 40 }]]);
	} finally {
		await act(async () => root.unmount());
		if (oldAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct);
		else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
		dom.restore();
	}
});
