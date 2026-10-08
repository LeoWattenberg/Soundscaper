/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { createAudioEditorPreferencesV1, createCustomAudioEditorWorkspace, deleteCustomAudioEditorWorkspace } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

for (const mode of ['removed', 'moved', 'retained', 'owner'] as const) test(`mounted workspace deletion focus respects ${mode}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let preferences = createCustomAudioEditorWorkspace(createAudioEditorPreferencesV1({}), { id: 'review', name: 'Keyboard review' });
	const deleted: string[] = [];
	let controller = { actions: { preferences: { deleteWorkspace(id: string) { deleted.push(id); } } } };
	const render = () => root.render(<WorkspacePreferencesDialog controller={controller} snapshot={{ preferences }}
		copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]} run={(operation: () => unknown) => operation()}
		initialPage="workspace" onTogglePanel={() => undefined} onClose={() => undefined} />);
	try {
		await act(async () => { render(); });
		const remove = dom.container.querySelectorAll('button').find(button => button.textContent === 'Delete'); assert.ok(remove);
		const picker = dom.container.querySelectorAll('[role="group"]').find(group => group.getAttribute('aria-label') === 'Workspace preset')?.querySelector('.dropdown__trigger'); assert.ok(picker);
		const name = dom.container.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Workspace name'); assert.ok(name);
		remove.focus();
		await act(async () => { reactProps(remove).onClick({ currentTarget: remove }); });
		assert.deepEqual(deleted, ['review']);
		if (mode !== 'retained') preferences = deleteCustomAudioEditorWorkspace(preferences, 'review');
		if (mode === 'owner') controller = { actions: { preferences: { deleteWorkspace() {} } } };
		if (mode === 'moved') name.focus();
		else if (mode !== 'retained') dom.container.ownerDocument.body.focus(); // Native disabled buttons lose focus.
		await act(async () => { render(); });
		assert.equal(dom.container.ownerDocument.activeElement, mode === 'removed' ? picker : mode === 'moved' ? name : mode === 'retained' ? remove : dom.container.ownerDocument.body);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
