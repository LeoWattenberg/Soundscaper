/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import GeneralPreferencesPage from '../src/common/editor/ui/dialogs/GeneralPreferencesPage.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('returning to the current language cancels a pending saved-project navigation', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const navigations: string[] = [];
	let release = (): void => undefined;
	let hold = false;
	const operations: Promise<unknown>[] = [];
	const controller = { actions: {
		preferences: { update: () => undefined },
		project: { flush: () => hold ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve() },
	} };
	try {
		await act(async () => root.render(<GeneralPreferencesPage controller={controller}
			snapshot={{ preferences: createAudioEditorPreferencesV1(), projects: [], project: { id: 'project-a' } }}
			copy={ENGLISH_COPY} locale="en" productId="soundscaper"
			fileService={{ isDesktop: true, setLocale: async (locale: string) => { navigations.push(locale); } }}
			run={(operation: () => Promise<unknown>) => { const promise = operation(); operations.push(promise); return promise; }} />));
		const choose = async (label: string): Promise<void> => {
			const group = dom.container.querySelectorAll('[role="group"]')
				.find(element => element.getAttribute('aria-label') === ENGLISH_COPY.languageLabel);
			assert.ok(group);
			const trigger = group.querySelector('.dropdown__trigger');
			assert.ok(trigger);
			await act(async () => { reactProps(trigger).onClick({}); await Promise.resolve(); });
			const option = (document.body as unknown as typeof dom.container).querySelectorAll('[role="option"]')
				.find(element => element.textContent === label);
			assert.ok(option, label);
			await act(async () => { reactProps(option).onClick({}); await Promise.resolve(); });
		};
		await choose('Deutsch');
		await Promise.all(operations);
		assert.deepEqual(navigations, ['de'], 'healthy language change waits for the project then navigates');
		hold = true;
		await choose('Deutsch');
		assert.deepEqual(navigations, ['de']);
		await choose('English');
		release();
		await Promise.all(operations);
		assert.deepEqual(navigations, ['de'], 'the later current-language choice cancels the older navigation');
		await choose('Deutsch');
		hold = false;
		await choose('Français');
		await operations.at(-1);
		assert.deepEqual(navigations, ['de', 'fr'], 'a later different language can finish while the old save is pending');
		release();
		await Promise.all(operations);
		assert.deepEqual(navigations, ['de', 'fr'], 'the older save cannot overwrite the newer language');
	} finally {
		release();
		await Promise.all(operations);
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
