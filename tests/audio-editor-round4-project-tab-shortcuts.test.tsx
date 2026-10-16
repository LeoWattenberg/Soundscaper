/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectTabs from '../src/common/editor/ui/workspace/ProjectTabs.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modified of [true, false]) {
	test(`project tab navigation ${modified ? 'preserves command chords' : 'keeps its plain arrow and endpoint contract'}`, async () => {
		const dom = installReactTestDom();
		Object.defineProperty(window, 'getComputedStyle', { configurable: true,
			value: () => ({ direction: 'ltr' }) });
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const selected: string[] = [];
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		try {
			await act(async () => { root.render(<ProjectTabs
				projects={[{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }]}
				activeProjectId="first" disabled={false} copy={ENGLISH_COPY}
				onSelect={(id: string) => { selected.push(id); }} onClose={() => undefined} onNew={() => undefined} />); });
			const tab = dom.one('[role="tab"]');
			for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
				for (const modifier of modified ? ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] : ['']) {
					let prevented = false;
					await act(async () => { reactProps(tab).onKeyDown?.({ key, [modifier]: true,
						currentTarget: tab, preventDefault() { prevented = true; } }); });
					assert.equal(prevented, !modified);
				}
			}
			assert.deepEqual(selected, modified ? [] : ['second', 'second', 'second']);
		} finally {
			await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
