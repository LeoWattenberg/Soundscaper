/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const ROWS: readonly PhotoLibraryRowV1[] = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({
	id, fileName: `${id}.png`, width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none',
})));
function row(id: string) { const found = ROWS.find(value => value.id === id); assert.ok(found); return found; }

for (const locale of ['en', 'de']) test(`actual ${locale} App exposes Compare only through View after multi-selection`, async () => {
	const fixture = owner(), mounted = await mount(fixture.factory, locale);
	try {
		assert.equal(fixture.opens(), 0); assert.equal(fixture.previews.length, 0);
		assert.equal(mounted.dom.find('[data-photo-compare-dialog]'), null); assert.equal(mounted.dom.find('canvas'), null);
		const menu = mounted.dom.one('[data-photo-compare-menu]'); assert.equal(menu.hasAttribute('disabled'), true);
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, mounted.copy.photoViewMenu);
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a');
		assert.equal(menu.hasAttribute('disabled'), true);
		await mounted.photo('c', true); assert.equal(menu.hasAttribute('disabled'), false);
		await mounted.click(menu); assert.ok(mounted.dom.find('[data-photo-compare-dialog]'));
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		assert.deepEqual(fixture.previews.map(value => value.slice(0, 2)), [['a', 'fit-screen'], ['c', 'fit-screen']]);
		assert.equal(mounted.side('reference').textContent.includes('a.png'), true);
		assert.equal(mounted.side('candidate').textContent.includes('c.png'), true);
		assert.deepEqual(mounted.selected(), ['a', 'c']); assert.equal(fixture.opens(), 1);
		await mounted.menu(mounted.copy.photoCloseMetadata);
		assert.equal(mounted.dom.find('[data-photo-compare-dialog]'), null); assert.equal(mounted.dom.find('canvas'), null);
		assert.deepEqual(mounted.selected(), ['a', 'c']);
	} finally { await mounted.dispose(); }
});

test('actual Compare keyboard changes the review pair while culling the focused side through the same catalog', async () => {
	const fixture = owner(), mounted = await mount(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('c', true); await mounted.photo('d', true);
		await mounted.click(mounted.dom.one('[data-photo-compare-menu]'));
		await mounted.key('candidate', 'ArrowRight'); assert.match(mounted.side('candidate').textContent, /d\.png/u);
		await mounted.key('candidate', 's'); assert.match(mounted.side('reference').textContent, /d\.png/u); assert.match(mounted.side('candidate').textContent, /a\.png/u);
		await mounted.key('candidate', 'Enter'); assert.match(mounted.side('reference').textContent, /a\.png/u); assert.match(mounted.side('candidate').textContent, /c\.png/u);
		await mounted.key('candidate', '5'); assert.deepEqual(fixture.writes, [['c', { rating: 5 }]]);
		assert.match(mounted.side('candidate').textContent, /Rating: 5/u); assert.deepEqual(mounted.selected(), ['a', 'c', 'd']);
		await mounted.key('reference', 'p'); assert.deepEqual(fixture.writes[1], ['a', { flag: 'pick' }]);
		await mounted.flush(() => { const select = mounted.dom.one('[data-compare-label="candidate"]'); reactProps(select).onChange?.({ currentTarget: { value: 'blue' } }); });
		assert.deepEqual(fixture.writes[2], ['c', { colorLabel: 'blue' }]); assert.equal(fixture.opens(), 1);
	} finally { await mounted.dispose(); }
});

test('closing a held Compare save hides the modal, aborts its signal, and rejects stale or queued edit gestures', async () => {
	const saved = deferred<PhotoLibraryRowV1>(), fixture = owner();
	fixture.port.setRating = async (id, rating, options) => { fixture.writes.push([id, { rating }]); fixture.signals.push(options?.signal); return saved.promise; };
	const mounted = await mount(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.click(mounted.dom.one('[data-photo-compare-menu]'));
		const staleSide = mounted.side('candidate'), staleKey = reactProps(staleSide).onKeyDown;
		await mounted.key('candidate', '3'); assert.equal(mounted.dom.one('[data-compare-rating="candidate"]').hasAttribute('disabled'), true);
		await mounted.key('candidate', '4'); assert.equal(fixture.writes.length, 1);
		await mounted.menu(mounted.copy.photoCloseMetadata); assert.equal(mounted.dom.find('[data-photo-compare-dialog]'), null);
		assert.equal(fixture.signals[0]?.aborted, true); assert.equal(mounted.dom.one('[data-photo-compare-menu]').hasAttribute('disabled'), true);
		await mounted.flush(() => { staleKey?.({ key: '5', currentTarget: staleSide, target: staleSide, preventDefault() {} }); });
		assert.equal(fixture.writes.length, 1);
		await mounted.flush(() => { saved.resolve({ ...row('b'), rating: 3 }); });
		assert.equal(mounted.dom.find('[data-photo-compare-dialog]'), null); assert.equal(mounted.dom.one('[data-photo-compare-menu]').hasAttribute('disabled'), false);
		assert.match(mounted.dom.one('[data-photo-id="b"]').textContent, /Rating: 3/u);
		await mounted.click(mounted.dom.one('[data-photo-compare-menu]')); assert.match(mounted.side('candidate').textContent, /Rating: 3/u);
	} finally { saved.resolve(row('b')); await mounted.flush(); await mounted.dispose(); }
});

test('one presenter joins held ordinary pixels before Compare reads, and restores opted-in previews after Close', async () => {
	const fixture = owner(), first = deferred<{ outcome: 'missing' }>(); let held = true;
	fixture.port.readPreview = async (id, tier, options) => {
		fixture.previews.push([id, tier, options?.signal]);
		if (held) { held = false; return first.promise; } return { outcome: 'missing' };
	};
	const mounted = await mount(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.menu(mounted.copy.photoShowThumbnails); assert.equal(fixture.previews.length, 1);
		await mounted.click(mounted.dom.one('[data-photo-compare-menu]'));
		assert.equal(fixture.previews.length, 1); assert.equal(fixture.previews[0]?.[2]?.aborted, true);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		await mounted.flush(() => { first.resolve({ outcome: 'missing' }); });
		assert.deepEqual(fixture.previews.slice(1).map(value => value.slice(0, 2)), [['a', 'fit-screen'], ['b', 'fit-screen']]);
		await mounted.menu(mounted.copy.photoCloseMetadata);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 4);
		assert.deepEqual(fixture.previews.slice(3).map(value => value.slice(0, 2)), ROWS.map(value => [value.id, 'thumbnail']));
	} finally { first.resolve({ outcome: 'missing' }); await mounted.flush(); await mounted.dispose(); }
});

function owner() {
	const port = createImportTestPort(); let opens = 0, rows = [...ROWS];
	const writes: [string, Partial<PhotoLibraryRowV1>][] = [], signals: (AbortSignal | undefined)[] = [];
	const previews: [string, string, AbortSignal | undefined][] = [];
	port.readPage = async () => ({ catalogName: 'Library', totalCount: rows.length, rows, cursor: null });
	port.readPreview = async (id, tier, options) => { previews.push([id, tier, options?.signal]); return { outcome: 'missing' }; };
	port.setRating = async (id, rating, options) => {
		writes.push([id, { rating }]); signals.push(options?.signal); const result = { ...row(id), rating };
		rows = rows.map(value => value.id === id ? result : value); return result;
	};
	port.applyAttributes = async (id, changes) => {
		writes.push([id, changes]); const found = rows.find(value => value.id === id); assert.ok(found); const result = { ...found, ...changes };
		rows = rows.map(value => value.id === id ? result : value); return result;
	};
	return { port, writes, signals, previews, opens: () => opens, factory: async () => { opens++; return port; } };
}

async function mount(initialFactory: CreatePhotoLibrarySessionV1, locale = 'en') {
	let factory = initialFactory;
	// These cases observe target ownership only. Ready pixels are qualified in
	// native browser tests; this protocol permits clearing zero backing only.
	const priorCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	class ScalarCanvasBacking {}
	for (const name of ['width', 'height']) Object.defineProperty(ScalarCanvasBacking.prototype, name, {
		get(this: ReactTestElement) { assert.equal(this.nodeName, 'CANVAS'); return Number(this.getAttribute(name) ?? 0); },
		set(this: ReactTestElement, value: number) { assert.equal(this.nodeName, 'CANVAS'); assert.equal(value, 0); this.setAttribute(name, String(value)); },
	});
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: ScalarCanvasBacking });
	const restoreCanvas = () => {
		if (priorCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', priorCanvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
	};
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperApp locale={locale} createSession={factory} /></StrictMode>;
	}).catch((error: unknown) => { restoreCanvas(); throw error; });
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const click = async (target: ReactTestElement, ctrlKey = false) => {
		assert.equal(target.hasAttribute('disabled'), false);
		await flush(() => { target.focus(); reactProps(target).onFocus?.({ currentTarget: target }); reactProps(target).onClick?.({ currentTarget: target, ctrlKey, metaKey: false, shiftKey: false }); });
	};
	const menu = async (text: string) => {
		const button = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === text); assert.ok(button, `Missing action ${text}`); await click(button);
	};
	const side = (name: string) => mounted.dom.one(`[data-compare-side="${name}"]`);
	return { ...mounted, flush, click, menu, side, copy: bundledLightscaperEditorCopyForLocale(locale),
		dispose: async () => { try { await mounted.dispose(); } finally { restoreCanvas(); } },
		photo: async (id: string, toggle = false) => { await click(mounted.dom.one(`[data-photo-id="${id}"]`), toggle); },
		selected: () => mounted.dom.container.querySelectorAll('[data-photo-id]').filter(value => value.getAttribute('aria-pressed') === 'true').map(value => value.getAttribute('data-photo-id')),
		key: async (name: string, key: string) => { await flush(() => { const target = side(name); target.focus(); reactProps(target).onKeyDown?.({ key, target, currentTarget: target, preventDefault() {} }); }); },
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); },
	};
}
