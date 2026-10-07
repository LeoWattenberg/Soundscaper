/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import GeneralPreferencesPage from '../src/common/editor/ui/dialogs/GeneralPreferencesPage.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { consumeLocaleProjectHandoff, rememberLocaleProjectHandoff, LOCALE_PROJECT_HANDOFF_SETTING }
	from '../src/common/editor/controller/document/locale-project-handoff.ts';
import { resolveStartupProjectId } from '../src/common/editor/startup-preferences.ts';

test('language navigation flushes and hands off the current project without changing startup preferences', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const prior = new Map(['React', 'location', 'sessionStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const values = new Map<string, string>();
	const navigations: string[] = [];
	let flushed = false;
	Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); },
	} });
	Object.defineProperty(globalThis, 'location', { configurable: true, value: {
		href: 'http://127.0.0.1:4322/en/', pathname: '/en/', hostname: '127.0.0.1',
		assign: (href: string) => { assert.equal(flushed, true); navigations.push(href); },
	} });
	const updates: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<GeneralPreferencesPage
			controller={{ actions: { project: { flush: async () => { flushed = true; } },
				preferences: { update: (patch: unknown) => { updates.push(patch); } } } }}
			snapshot={{ project: { id: 'working-project' }, preferences: { startup: { mode: 'new-project', projectId: '' } }, projects: [] }}
			copy={ENGLISH_COPY} locale="en" productId="soundscaper" fileService={{ isDesktop: false }}
			run={(operation: () => Promise<unknown>) => { void operation(); }} />); });
		const trigger = dom.one('.dropdown__trigger');
		await act(async () => { reactProps(trigger).onClick({}); });
		const option = (globalThis.document as unknown as { body: typeof dom.container }).body
			.querySelectorAll('[role="option"]').find(node => node.textContent === 'Deutsch');
		assert.ok(option);
		await act(async () => { reactProps(option).onClick({}); await Promise.resolve(); });
		assert.deepEqual(navigations, ['/de/']);
		assert.equal(values.size, 1, 'the ordinary navigation carries one same-tab project handoff');
		assert.equal((JSON.parse([...values.values()][0]!) as { projectId: string }).projectId, 'working-project');
		assert.deepEqual(updates, [], 'a language change does not rewrite the next-session startup policy');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		for (const [name, descriptor] of prior) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
});

function handoffFixture() {
	const values = new Map<string, string>();
	let pathname = '/embed/en/';
	let now = 1_000;
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); },
	};
	return { values, resources: { storage: () => storage,
		location: () => ({ href: `http://127.0.0.1:4322${pathname}`, pathname }), now: () => now },
		move: (value: string) => { pathname = value; }, elapse: () => { now += 300_001; } };
}

test('the same-tab locale handoff is consumed once, then the saved next-session policy applies', () => {
	const fixture = handoffFixture();
	rememberLocaleProjectHandoff(fixture.resources, 'soundscaper', 'current', '/embed/de/');
	fixture.move('/embed/de/');
	const startup = () => consumeLocaleProjectHandoff(fixture.resources, LOCALE_PROJECT_HANDOFF_SETTING)
		?? resolveStartupProjectId({ mode: 'new-project', projectId: '' }, 'last');
	assert.equal(startup(), 'current');
	assert.equal(startup(), null);
	assert.equal(fixture.values.size, 0);
});

test('locale handoffs keep product inventories separate and require the chosen destination', () => {
	const fixture = handoffFixture();
	rememberLocaleProjectHandoff(fixture.resources, 'framescaper', 'picture', '/embed/de/');
	assert.equal(consumeLocaleProjectHandoff(fixture.resources, LOCALE_PROJECT_HANDOFF_SETTING), null);
	assert.equal(fixture.values.size, 1);
	fixture.move('/embed/fr/');
	assert.equal(consumeLocaleProjectHandoff(fixture.resources, `framescaper:${LOCALE_PROJECT_HANDOFF_SETTING}`), null);
	assert.equal(fixture.values.size, 0, 'an unrelated later route cannot inherit the old navigation');
	rememberLocaleProjectHandoff(fixture.resources, 'framescaper', 'picture', '/embed/de/');
	fixture.move('/embed/de/');
	assert.equal(consumeLocaleProjectHandoff(fixture.resources, `framescaper:${LOCALE_PROJECT_HANDOFF_SETTING}`), 'picture');
});

test('an expired locale navigation cannot override a later editor launch', () => {
	const fixture = handoffFixture();
	rememberLocaleProjectHandoff(fixture.resources, 'soundscaper', 'current', '/embed/de/');
	fixture.move('/embed/de/'); fixture.elapse();
	assert.equal(consumeLocaleProjectHandoff(fixture.resources, LOCALE_PROJECT_HANDOFF_SETTING), null);
	assert.equal(fixture.values.size, 0);
});
