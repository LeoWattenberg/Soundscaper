/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const ownership of ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] as const) {
	test(`Preferences sidebar keeps its page for ${ownership} navigation`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let prevented = 0;
		let stopped = 0;
		try {
			await act(async () => { root.render(<WorkspacePreferencesDialog
				controller={{ actions: { preferences: { update: () => undefined } } }}
				snapshot={{ preferences: createAudioEditorPreferencesV1({}) }}
				initialPage="general"
				copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]}
				run={(operation: () => unknown) => operation()} onTogglePanel={() => undefined}
				onClose={() => undefined} />); });
			const general = dom.one('[aria-controls="dialog-panel-general"]');
			general.focus();
			const event = {
				key: 'End', target: general, ctrlKey: false, altKey: false, metaKey: false,
				defaultPrevented: false, [ownership]: true,
				preventDefault: () => { prevented += 1; },
				stopPropagation: () => { stopped += 1; },
			};
			const adapter = dom.one('.kw-audio-editor-preferences__sidebar-adapter');
			await act(async () => { reactProps(adapter).onKeyDownCapture?.(event); });
			assert.equal(general.getAttribute('aria-selected'), 'true');
			assert.equal(prevented, 0, 'browser navigation retains its default behavior');
			assert.equal(stopped, 1, 'the vendor arrow handler does not receive the released chord');
			assert.equal(general.ownerDocument.activeElement, general);
			await act(async () => { reactProps(adapter).onKeyDownCapture?.({ ...event, [ownership]: false }); });
			assert.equal(dom.one('[aria-controls="dialog-panel-workspace"]').getAttribute('aria-selected'), 'true');
			assert.equal(prevented, 1);
			assert.equal(stopped, 2);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
