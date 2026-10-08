/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { CommunityTranslationPresentationPort } from '../src/common/editor/ui/community-translations/community-translation-presentation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { useTranslationRemovalFocus } from '../src/common/editor/ui/community-translations/useTranslationRemovalFocus.ts';
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

for (const mode of ['filtered', 'retained', 'moved'] as const) test(`mounted translation removal preserves useful focus: ${mode}`, async () => {
	await loadCommunityTranslationSnapshot('de');
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const values = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	} });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const port: CommunityTranslationPresentationPort = {
		publishedCopy: ENGLISH_COPY, getSnapshot: () => ({ copy: ENGLISH_COPY, locale: 'en', revision: 0 }),
		subscribe: () => () => {}, applyPreview() {}, resetPreview() {},
	};
	try {
		await act(async () => { root.render(<CommunityTranslationSurface port={port} initialLocale="de" copy={ENGLISH_COPY}
			fileService={{ saveFile: async () => undefined }} onClose={() => {}} />); });
		const search = dom.container.querySelectorAll('input').find(item => item.type === 'search');
		assert.ok(search);
		await act(async () => { reactProps(search).onChange({ target: { value: 'play' } }); });
		const messages = dom.container.querySelectorAll('select').find(item => item.getAttribute('size') === '6');
		assert.ok(messages);
		await act(async () => { reactProps(messages).onChange({ target: { value: 'play' } }); });
		const translation = dom.container.querySelectorAll('textarea').find(item => !Reflect.get(reactProps(item), 'readOnly') && Reflect.get(reactProps(item), 'rows') === 3);
		assert.ok(translation);
		await act(async () => { reactProps(translation).onChange({ target: { value: 'Wiedergabe Test' } }); });
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
		const filter = dom.container.querySelectorAll('select').find(item => item.options.some(option => option.value === 'changed'));
		assert.ok(filter);
		if (mode !== 'retained') await act(async () => { reactProps(filter).onChange({ target: { value: 'changed' } }); });
		const remove = dom.container.querySelectorAll('button').find(item => item.textContent === 'Remove this change');
		assert.ok(remove);
		remove.focus();
		const contributor = dom.container.querySelectorAll('input').find(item => item !== search && !Reflect.get(reactProps(item), 'readOnly'));
		assert.ok(contributor);
		await act(async () => {
			reactProps(remove).onClick({ currentTarget: remove });
			if (mode === 'moved') contributor.focus();
		});
		assert.equal(remove.isConnected, mode === 'retained');
		assert.equal(search.ownerDocument.activeElement, mode === 'moved' ? contributor : search);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
	}
});

test('translation removal belongs to its locale and does not recover after unmount', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	function Fixture({ locale, visible }: { locale: string; visible: boolean }) {
		const search = useRef<HTMLInputElement>(null);
		const remember = useTranslationRemovalFocus(locale, search);
		return <><input ref={search} />{visible && <button onClick={event => remember(event.currentTarget)}>Remove</button>}</>;
	}
	try {
		await act(async () => { root.render(<Fixture locale="de" visible />); });
		const remove = dom.one('button'); remove.focus();
		await act(async () => {
			reactProps(remove).onClick({ currentTarget: remove });
			root.render(<Fixture locale="fr" visible={false} />);
		});
		assert.equal(remove.ownerDocument.activeElement, remove);
		await act(async () => { root.render(<Fixture locale="de" visible />); });
		const next = dom.one('button'); next.focus();
		await act(async () => { reactProps(next).onClick({ currentTarget: next }); root.unmount(); });
		assert.equal(next.ownerDocument.activeElement, next);
	} finally {
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
