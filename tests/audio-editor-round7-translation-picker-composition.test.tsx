/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

// Mirror Vite's raw notice asset import; the message picker never reads its content.
const assets = registerHooks({ load(url, context, nextLoad) {
	if (new URL(url).pathname.endsWith('/translations/LICENSE.txt')) {
		return { format: 'module', source: "export default '';", shortCircuit: true };
	}
	return nextLoad(url, context);
} });
const { default: CommunityTranslationSurface } = await import('../src/common/editor/ui/community-translations/CommunityTranslationSurface.tsx');
assets.deregister();

for (const nativeState of [{ isComposing: true, keyCode: 27 }, { isComposing: false, keyCode: 229 }]) {
	test(`the mounted translation picker releases native Escape (${nativeState.isComposing ? 'composition' : '229'})`, async () => {
		const dom = installReactTestDom();
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const listeners = new Set<EventListenerOrEventListenerObject>();
		document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) listeners.add(listener);
		};
		document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) listeners.delete(listener);
		};
		const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		const storage = new Map<string, string>();
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value); },
		} });
		const root = createRoot(dom.container as unknown as Element);
		let closed = 0;
		try {
			await act(async () => root.render(<CommunityTranslationSurface initialLocale="de" copy={ENGLISH_COPY}
				fileService={{ saveFile: async () => undefined }} onClose={() => { closed += 1; }} port={{
					publishedCopy: ENGLISH_COPY, subscribe: () => () => undefined,
					getSnapshot: () => ({ locale: 'en', copy: ENGLISH_COPY, revision: 0 }),
					applyPreview() {}, resetPreview() {},
				}} />));
			const surface = dom.one('[data-community-translation-surface]');
			const pick = dom.one('[aria-pressed="false"]');
			const search = dom.container.querySelectorAll('input').find(node => node.type === 'search');
			assert.ok(search);
			const arm = async () => { await act(async () => { reactProps(pick).onClick(); }); };
			const dispatch = async (state: typeof nativeState): Promise<Event> => {
				const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', ...state });
				Object.defineProperty(event, 'target', { value: search });
				await act(async () => {
					for (const listener of listeners) {
						if (typeof listener === 'function') listener(event);
						else listener.handleEvent(event);
					}
				});
				return event;
			};
			await arm();
			assert.equal((await dispatch({ isComposing: false, keyCode: 27 })).defaultPrevented, true);
			assert.equal(pick.getAttribute('aria-pressed'), 'false');
			assert.equal(closed, 0);
			await arm();
			search.focus();
			assert.equal((await dispatch(nativeState)).defaultPrevented, false);
			assert.equal(pick.getAttribute('aria-pressed'), 'true');
			let prevented = false;
			await act(async () => { reactProps(surface).onKeyDown({ key: 'Escape', nativeEvent: nativeState,
				preventDefault() { prevented = true; }, stopPropagation() {} }); });
			assert.equal(prevented, false);
			assert.equal(closed, 0);
			assert.equal(dom.container.ownerDocument.activeElement, search);
			assert.equal((await dispatch({ isComposing: false, keyCode: 27 })).defaultPrevented, true);
			assert.equal(pick.getAttribute('aria-pressed'), 'false');
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
			else Reflect.deleteProperty(globalThis, 'localStorage');
			dom.restore();
		}
	});
}
