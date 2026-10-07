/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MetadataEditorTabs from '../src/common/editor/ui/MetadataEditorTabs.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modified of [true, false]) {
	test(`metadata tab navigation ${modified ? 'preserves command chords' : 'keeps its plain arrow and endpoint contract'}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const selected: string[] = [];
		try {
			await act(async () => { root.render(<MetadataEditorTabs activeTab="general" showBext showAdm
				copy={{ metadataGeneralTab: 'General', metadataBextTab: 'BWF', metadataAdmTab: 'ADM' }}
				onChange={id => { selected.push(id); }} />); });
			const tab = dom.one('[role="tab"]');
			for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
				for (const modifier of modified ? ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] : ['']) {
					let prevented = false;
					await act(async () => { reactProps(tab).onKeyDown?.({ key, [modifier]: true,
						currentTarget: tab, preventDefault() { prevented = true; } }); });
					assert.equal(prevented, !modified);
				}
			}
			assert.deepEqual(selected, modified ? [] : ['bext', 'adm', 'adm', 'general']);
			if (!modified) assert.equal(document.activeElement, tab);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
