/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { CommunityTranslationPresentationPort } from '../src/common/editor/ui/community-translations/community-translation-presentation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const rawTextHook = registerHooks({ load(url, context, nextLoad) {
	if (url.endsWith('/translations/LICENSE.txt?raw')) return {
		format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true,
	};
	return nextLoad(url, context);
} });
const { default: CommunityTranslationSurface } = await import('../src/common/editor/ui/community-translations/CommunityTranslationSurface.tsx');
const { loadCommunityTranslationSnapshot } = await import('../src/common/editor/ui/community-translations/community-translation-files.ts');
rawTextHook.deregister();

test('translation surface releases composing Escape and retains ordinary dismissal', async () => {
	await loadCommunityTranslationSnapshot('de');
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const values = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	} });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const port: CommunityTranslationPresentationPort = {
		publishedCopy: ENGLISH_COPY, getSnapshot: () => ({ copy: ENGLISH_COPY, locale: 'en', revision: 0 }),
		subscribe: () => () => {}, applyPreview() {}, resetPreview() {},
	};
	let closed = 0;
	try {
		await act(async () => root.render(<CommunityTranslationSurface port={port} initialLocale="de" copy={ENGLISH_COPY}
			fileService={{ saveFile: async () => undefined }} onClose={() => { closed += 1; }} />));
		const surface = dom.one('[data-community-translation-surface]');
		const translation = dom.container.querySelectorAll('textarea').find(field => field.getAttribute('rows') === '3');
		assert.ok(translation);
		await act(async () => reactProps(translation).onChange({ target: { value: 'とう' } }));
		translation.focus();
		let prevented = false;
		await act(async () => reactProps(surface).onKeyDown({
			key: 'Escape', nativeEvent: { isComposing: true },
			preventDefault() { prevented = true; }, stopPropagation() {},
		}));
		assert.equal(closed, 0, 'native composition does not discard the unsaved translation surface');
		assert.equal(prevented, false);
		assert.equal(translation.value, 'とう');
		assert.equal(translation.ownerDocument.activeElement, translation);
		await act(async () => reactProps(surface).onKeyDown({
			key: 'Escape', nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(closed, 1, 'completed Escape retains the surface dismissal');
	} finally {
		await act(async () => root.unmount());
		dom.restore(); environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
		else Reflect.deleteProperty(globalThis, 'localStorage');
	}
});
