/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

for (const mode of ['unchanged', 'newer', 'restored', 'refused'] as const) test(`Workspace Create completion owns only its ${mode} name draft`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let resolveSave: () => void = () => { throw new Error('No pending workspace save'); };
	let rejectSave: (error: Error) => void = () => { throw new Error('No pending workspace save'); };
	const save = new Promise<void>((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
	const created: string[] = [];
	const controller = { actions: { preferences: { createWorkspace(name: string) { created.push(name); return save; } } } };
	try {
		await act(async () => { root.render(<WorkspacePreferencesDialog controller={controller}
			snapshot={{ preferences: createAudioEditorPreferencesV1({}) }} copy={ENGLISH_COPY} locale="en"
			fileService={{ isDesktop: false }} menus={[]} run={(operation: () => unknown) => operation()}
			initialPage="workspace" onTogglePanel={() => undefined} onClose={() => undefined} />); });
		const name = dom.container.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Workspace name');
		const create = dom.container.querySelectorAll('button').find(button => button.textContent === 'Create from current layout');
		assert.ok(name && create);
		await act(async () => { reactProps(name).onChange({ currentTarget: { value: '  First layout  ' } }); });
		await act(async () => { reactProps(create).onClick(); });
		assert.deepEqual(created, ['First layout']);
		assert.equal(name.value, '  First layout  ', 'a pending durable save retains its draft');
		if (mode === 'newer' || mode === 'restored') {
			await act(async () => { reactProps(name).onChange({ currentTarget: { value: 'Next layout' } }); });
			if (mode === 'restored') await act(async () => { reactProps(name).onChange({ currentTarget: { value: '  First layout  ' } }); });
		}
		await act(async () => {
			if (mode === 'refused') rejectSave(new Error('Device storage is full'));
			else resolveSave();
			await Promise.resolve();
		});
		assert.equal(name.value, mode === 'unchanged' ? '' : mode === 'newer' ? 'Next layout' : '  First layout  ');
	} finally {
		resolveSave();
		await act(async () => { root.unmount(); });
		dom.restore();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
