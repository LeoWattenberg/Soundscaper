/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import WorkspacePanelHeader from '../src/common/editor/ui/workspace/WorkspacePanelHeader.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Header = WorkspacePanelHeader as unknown as React.ComponentType<Record<string, unknown>>;

test('workspace tabs leave modified navigation keys for configured editor shortcuts', async () => {
	await mountedTabs(async ({ tabs, selected }) => {
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
			for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
				let prevented = false;
				await act(async () => { reactProps(tabs[0]!).onKeyDown?.({ key, [modifier]: true,
					currentTarget: tabs[0], preventDefault: () => { prevented = true; } }); });
				assert.equal(prevented, false, `${modifier} ${key} belongs to the editor shortcut map`);
				assert.deepEqual(selected, []);
			}
		}
	});
});

test('unmodified workspace navigation retains arrow and endpoint selection', async () => {
	await mountedTabs(async ({ tabs, selected }) => {
		for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
			let prevented = false;
			await act(async () => { reactProps(tabs[0]!).onKeyDown?.({ key,
				currentTarget: tabs[0], preventDefault: () => { prevented = true; } }); });
			assert.equal(prevented, true);
		}
		assert.deepEqual(selected, ['markers', 'markers', 'markers', 'history']);
	});
});

async function mountedTabs(check: (fixture: {
	readonly tabs: ReturnType<typeof installReactTestDom>['container'][];
	readonly selected: string[];
}) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ direction: 'ltr' }) });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const selected: string[] = [];
	try {
		await act(async () => { root.render(<Header panelId="history" activePanelId="history" label="History"
			copy={{ panels: 'Panels', panelMenu: 'Panel menu' }}
			tabs={[{ id: 'history', label: 'History' }, { id: 'markers', label: 'Markers' }]}
			onTabActivate={(id: string) => { selected.push(id); }} />); });
		await check({ tabs: dom.container.querySelectorAll('[role="tab"]'), selected });
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
}
