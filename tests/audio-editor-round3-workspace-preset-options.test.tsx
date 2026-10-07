/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

for (const [productId, expected] of [
	['soundscaper', ['Soundscaper', 'Audacity', 'Music', 'Classic', 'My layout']],
	['framescaper', ['Video editor', 'My layout']],
] as const) test(`${productId} Preferences uses its product presets and keeps saved custom layouts`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const chosen: string[] = [];
	const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: productId === 'framescaper' ? 'video-editor' : 'modern' } });
	preferences.workspace.custom = [{ id: 'mine', name: 'My layout', layout: preferences.workspace }];
	try {
		await act(async () => { root.render(<WorkspacePreferencesDialog productId={productId}
			controller={{ actions: { preferences: { setWorkspace: (id: string) => { chosen.push(id); } } } }}
			snapshot={{ preferences }} copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }}
			menus={[]} run={(operation: () => unknown) => operation()} initialPage="workspace"
			onTogglePanel={() => undefined} onClose={() => undefined} />); });
		const picker = dom.container.ownerDocument.body.querySelectorAll('[role="group"]').find((node) => node.getAttribute('aria-label') === 'Workspace preset');
		assert.ok(picker);
		const trigger = picker.querySelector('button');
		assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick(); });
		const options = dom.container.ownerDocument.body.querySelectorAll('[role="option"]');
		assert.deepEqual(options.map((option) => option.textContent), [...expected]);
		const custom = options.find((option) => option.textContent === 'My layout');
		assert.ok(custom);
		await act(async () => { reactProps(custom).onClick(); });
		assert.deepEqual(chosen, ['mine']);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
