/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackListView } from '../src/common/editor/ui/timeline/TrackListView.jsx';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, altKey: true }]) {
	void test(`folder tree releases configured command keys ${JSON.stringify(modifiers)}`, async () => {
		const dom = installReactTestDom();
		const oldReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
		const root = createRoot(dom.container as unknown as Element);
		Object.defineProperty(document, 'getElementById', { configurable: true,
			value: (id: string) => dom.container.querySelectorAll('[data-track-folder-row]').find(row => row.getAttribute('id') === id) ?? null });
		const project = createCurrentAudioEditorProject({
			id: 'folder-shortcuts', title: 'Folder shortcuts', primarySequenceId: 'main',
			trackFolders: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
			sequences: [{ id: 'main', trackNodes: [
				{ kind: 'folder', id: 'first', parentFolderId: null },
				{ kind: 'folder', id: 'second', parentFolderId: null },
			] }],
		});
		const edits: unknown[] = [];
		const noop = () => undefined;
		const controller = { actions: { trackFolders: {
			select: noop, toggleCollapsed: noop, update: noop, rename: noop,
			moveNode: (...args: unknown[]) => { edits.push(args); },
		} } };
		const Component = TrackListView as unknown as React.ComponentType<Record<string, unknown>>;
		try {
			await act(async () => root.render(<Component project={project} controller={controller}
				snapshot={{ trackFolders: createDocumentTrackFolderSnapshot(project), preferences: {}, capabilities: {} }}
				locale="en" copy={ENGLISH_COPY} run={(action: () => unknown) => action()} visualTrackHeight={() => 100}
				mutationsBlocked={false} isFlatNavigation={true} panelWidth={180} setTrackMenu={noop} />));
			const rows = dom.container.querySelectorAll('[data-track-folder-row]');
			assert.equal(rows.length, 2);
			const row = rows[1];
			assert.ok(row);
			let consumed = 0;
			await act(async () => { reactProps(row).onKeyDown?.({
				key: 'ArrowUp', target: row, currentTarget: row, ctrlKey: false, metaKey: false,
				altKey: false, shiftKey: false, defaultPrevented: false, ...modifiers,
				preventDefault: () => { consumed += 1; }, stopPropagation: () => { consumed += 1; },
			}); });
			assert.equal(consumed, 0);
			assert.deepEqual(edits, []);
		} finally {
			await act(async () => root.unmount());
			for (const [key, descriptor] of [['React', oldReact], ['IS_REACT_ACT_ENVIRONMENT', oldAct]] as const) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		}
	});
}
