/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import GeneralPreferencesPage from '../src/common/editor/ui/dialogs/GeneralPreferencesPage.jsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('general preferences persists the live project shown for a stale startup id', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const updates: Record<string, unknown>[] = [];
	const controller = {
		actions: {
			preferences: {
				update: async (value: Record<string, unknown>) => { updates.push(value); },
			},
			project: { flush: async () => undefined },
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			root.render(<GeneralPreferencesPage
				controller={controller}
				snapshot={{
					preferences: { startup: { mode: 'project', projectId: 'deleted' } },
					projects: [{ id: 'project-q', title: 'Project Q' }],
				}}
				copy={{
					languageLabel: 'Language', programStart: 'Program start',
					startupContinueLastSession: 'Continue', startupNewProject: 'New',
					startupProject: 'Project', startupProjectSelect: 'Startup project',
				}}
				locale="en"
				fileService={{ isDesktop: false }}
				productId="soundscaper"
				run={(operation: () => Promise<void>) => { void operation(); }}
			/>);
			await Promise.resolve();
		});
		assert.deepEqual(updates, [{
			startup: { mode: 'project', projectId: 'project-q' },
		}]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
