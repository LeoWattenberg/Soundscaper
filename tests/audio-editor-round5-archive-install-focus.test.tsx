/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NyquistGetEffectsDialog from '../src/common/editor/ui/dialogs/NyquistGetEffectsDialog.jsx';
import { createNyquistArchiveStore, nyquistArchiveStore } from '../src/common/editor/nyquist/archive-store.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;
const manifest = gunzipSync(readFileSync(new URL('./fixtures/nyquist-archive/manifest.json.gz', import.meta.url)));
const metadata = readFileSync(new URL('../evidence/nyquist-plugin-publication/catalog-metadata-ed168a19631ec48d0029dfb5c17d16c339a174c1.json', import.meta.url));
const source = gunzipSync(readFileSync(new URL('./fixtures/nyquist-archive/10bandeq.ny.gz', import.meta.url)));

for (const moved of [false, true]) test(`mounted archive installation ${moved ? 'preserves deliberate movement' : 'restores its enabled removal action'}`, async () => {
	const dom = installReactTestDom();
	const document = dom.container.ownerDocument;
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousFetch = globalThis.fetch;
	const previousStore = { list: nyquistArchiveStore.list, install: nyquistArchiveStore.install,
		remove: nyquistArchiveStore.remove, updateCatalogMetadata: nyquistArchiveStore.updateCatalogMetadata };
	const saved = new Map<string, string>();
	const store = createNyquistArchiveStore({ getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } });
	nyquistArchiveStore.list = store.list; nyquistArchiveStore.install = store.install;
	nyquistArchiveStore.remove = store.remove; nyquistArchiveStore.updateCatalogMetadata = store.updateCatalogMetadata;
	let completeDownload: ((response: Response) => void) | null = null;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith('/manifest.json')) return new Response(new Uint8Array(manifest).buffer);
		if (url.includes('/catalog-metadata-')) return new Response(new Uint8Array(metadata).buffer);
		assert.ok(url.endsWith('/files/10bandeq.ny'), 'download the unchanged, digest-pinned published effect');
		return new Promise<Response>(resolve => { completeDownload = resolve; });
	};
	try {
		await act(async () => {
			root.render(<NyquistGetEffectsDialog copy={ENGLISH_COPY} onClose={() => undefined} />);
		});
		for (let attempt = 0; attempt < 50 && !dom.container.querySelectorAll('button').some(button => button.textContent === 'Install Ten Band EQ'); attempt += 1) {
			await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
		}
		const install = dom.container.querySelectorAll('button').find(button => button.textContent === 'Install Ten Band EQ'); assert.ok(install);
		const search = dom.container.querySelectorAll('input').find(input => input.type === 'search'); assert.ok(search);
		install.focus();
		await act(async () => { reactProps(install).onClick(); });
		assert.ok(install.hasAttribute('disabled'));
		document.body.focus(); // Match the native disabled-control blur observed in the public browser workflow.
		if (moved) search.focus();
		assert.ok(completeDownload);
		await act(async () => { (completeDownload as (response: Response) => void)(new Response(new Uint8Array(source).buffer)); });
		for (let attempt = 0; attempt < 50 && !dom.container.querySelectorAll('button').some(button => button.textContent.startsWith('Remove') && button.textContent.endsWith('Ten Band EQ')); attempt += 1) {
			await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); });
		}
		assert.equal(store.list().length, 1, 'the actual authenticated installer commits the published source');
		const remove = dom.container.querySelectorAll('button').find(button => button.textContent.startsWith('Remove') && button.textContent.endsWith('Ten Band EQ')); assert.ok(remove);
		assert.equal(remove.hasAttribute('disabled'), false);
		assert.equal(document.activeElement, moved ? search : remove);
	} finally {
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		globalThis.fetch = previousFetch; Object.assign(nyquistArchiveStore, previousStore);
	}
});
