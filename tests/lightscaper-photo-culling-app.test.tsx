/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

// Fixture budget: four scalar rows, one held durable save and one held refresh
// per case. Actual App/workflow/selection owners run; no pixels or originals do.
const ROWS: readonly PhotoLibraryRowV1[] = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({
	id, fileName: `${id}.png`, width: 1, height: 1, rating: 0, flag: 'unflagged', colorLabel: 'none',
})));
const page = (rows: readonly PhotoLibraryRowV1[] = ROWS, catalogName = 'Library'): PhotoLibraryPageV1 =>
	Object.freeze({ catalogName, totalCount: rows.length, rows: Object.freeze([...rows]), cursor: null });
const updated = (id: string, rating: number): PhotoLibraryRowV1 => Object.freeze({ ...row(id), rating });
function row(id: string): PhotoLibraryRowV1 { const value = ROWS.find(candidate => candidate.id === id); assert.ok(value); return value; }

test('actual App keeps filmstrip and auto advance off until their View and File Photo menu actions', async () => {
	const session = owner(), mounted = await mount(session.factory, true);
	try {
		assert.equal(session.opens(), 0); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		assert.equal(mounted.dom.find('canvas'), null); assert.equal(mounted.button('Show filmstrip').hasAttribute('disabled'), true);
		assert.equal(mounted.button('Show filmstrip').getAttribute('aria-pressed'), 'false');
		assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'false');
		assert.equal(mounted.button('Show filmstrip').closest('details')?.querySelector('summary')?.textContent, 'View');
		const photoMenu = mounted.button('Auto advance').closest('details');
		assert.equal(photoMenu?.querySelector('summary')?.textContent, 'Photo');
		assert.equal(photoMenu?.parentNode?.parentNode?.textContent.startsWith('File'), true);
		await mounted.menu('Show photo library');
		assert.equal(session.opens(), 1); assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('data-photo-layout'), 'grid');
		await mounted.menu('Show filmstrip');
		assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('data-photo-layout'), 'filmstrip');
		assert.equal(mounted.button('Hide filmstrip').getAttribute('aria-pressed'), 'true');
		await mounted.menu('Hide filmstrip');
		assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('data-photo-layout'), 'grid');
		await mounted.menu('Auto advance'); assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'true');
		await mounted.menu('Auto advance'); assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'false');
		assert.equal(session.previewReads(), 0); assert.equal(mounted.dom.find('canvas'), null);
	} finally { await mounted.dispose(); }
	assert.equal(session.closes(), 1);
});

test('actual cards support Ctrl/Cmd toggles and Shift ranges while native focus preserves the selected subset', async () => {
	const session = owner(), mounted = await mount(session.factory);
	try {
		await mounted.menu('Show photo library');
		await mounted.photoClick('a'); await mounted.photoClick('c', { ctrlKey: true });
		assert.deepEqual(mounted.selected(), ['a', 'c']);
		await mounted.focus('b'); assert.deepEqual(mounted.selected(), ['a', 'c']); assert.equal(mounted.focused(), 'b');
		await mounted.photoClick('c', { metaKey: true }); assert.deepEqual(mounted.selected(), ['a']);
		await mounted.photoClick('b'); await mounted.photoClick('d', { shiftKey: true });
		assert.deepEqual(mounted.selected(), ['b', 'c', 'd']);
		await mounted.focus('a'); assert.deepEqual(mounted.selected(), ['b', 'c', 'd']);
		assert.equal(await mounted.key('a', 'ArrowRight', { ctrlKey: true }), 1);
		assert.equal(mounted.focused(), 'b'); assert.deepEqual(mounted.selected(), ['b', 'c', 'd']);
		assert.equal(await mounted.key('b', 'Home'), 1); assert.deepEqual(mounted.selected(), ['a']); assert.equal(mounted.focused(), 'a');
		assert.equal(await mounted.key('a', 'End'), 1); assert.deepEqual(mounted.selected(), ['d']); assert.equal(mounted.focused(), 'd');
		assert.equal(await mounted.key('d', 'Home', { shiftKey: true }), 1); assert.deepEqual(mounted.selected(), ['a', 'b', 'c', 'd']);
		assert.equal(await mounted.key('a', 'Escape'), 1); assert.deepEqual(mounted.selected(), []);
		assert.equal(await mounted.key('a', 'a', { metaKey: true }), 1); assert.deepEqual(mounted.selected(), ['a', 'b', 'c', 'd']);
		await mounted.menu('Clear photo selection'); assert.deepEqual(mounted.selected(), []);
		assert.equal(await mounted.key('b', 'a', { ctrlKey: true }), 1); assert.deepEqual(mounted.selected(), ['a', 'b', 'c', 'd']);
		assert.equal(session.writes.length, 0); assert.equal(session.previewReads(), 0);
	} finally { await mounted.dispose(); }
});

test('actual keyboard rating waits for durable acknowledgement, rejects queued keys, and leaves auto advance off by default', async () => {
	const saved = deferred<PhotoLibraryRowV1>(), session = owner(), mounted = await mount(session.factory);
	session.saveRating = () => saved.promise;
	try {
		await mounted.menu('Show photo library'); await mounted.photoClick('a');
		assert.equal(await mounted.key('a', '3'), 1);
		assert.deepEqual(session.writes.map(write => [write.id, write.rating]), [['a', 3]]);
		assert.equal(session.writes[0]?.signal?.aborted, false);
		assert.deepEqual(mounted.selected(), ['a']); assert.match(mounted.photo('a').textContent, /Rating: 0/u);
		assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('aria-busy'), 'true');
		assert.equal(mounted.button('Auto advance').hasAttribute('disabled'), true);
		assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'false');
		await mounted.key('a', '4'); assert.equal(session.writes.length, 1);
		await mounted.flush(() => { saved.resolve(updated('a', 3)); });
		assert.match(mounted.photo('a').textContent, /Rating: 3/u); assert.deepEqual(mounted.selected(), ['a']);
		assert.equal(mounted.focused(), 'a'); assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('aria-busy'), 'false');
		assert.equal(mounted.button('Auto advance').hasAttribute('disabled'), false);
	} finally { saved.resolve(updated('a', 3)); await mounted.flush(); await mounted.dispose(); }
});

test('actual File Photo rating advances only after its saved receipt publishes the exact refreshed query page', async () => {
	const saved = deferred<PhotoLibraryRowV1>(), refresh = deferred<PhotoLibraryPageV1>();
	const session = owner(), mounted = await mount(session.factory); let queries = 0;
	session.saveRating = () => saved.promise;
	session.port.readQueryStep = async () => ({ ...(queries++ < 2 ? page() : await refresh.promise), scanned: 4 });
	try {
		await mounted.activateQuery(); await mounted.photoClick('a'); await mounted.menu('Auto advance');
		await mounted.menu('Rate 5 stars'); assert.deepEqual(session.writes.map(write => [write.id, write.rating]), [['a', 5]]);
		assert.deepEqual(mounted.selected(), ['a']);
		assert.equal(mounted.button('Auto advance').hasAttribute('disabled'), true);
		assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'true');
		await mounted.flush(() => { saved.resolve(updated('a', 5)); });
		assert.equal(queries, 3); assert.match(mounted.photo('a').textContent, /Rating: 0/u);
		assert.deepEqual(mounted.selected(), ['a'], 'an active query keeps its prior page until the exact saved refresh completes');
		assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('aria-busy'), 'true');
		assert.equal(mounted.button('Auto advance').hasAttribute('disabled'), true);
		// The old successor b survives but moves behind c; advance follows identity,
		// rather than the refreshed row index or a separately published edited row.
		await mounted.flush(() => { refresh.resolve(page([row('c'), row('b'), row('d')], 'Refreshed library')); });
		assert.deepEqual(mounted.selected(), ['b']); assert.equal(mounted.focused(), 'b');
		assert.match(mounted.dom.one('[data-photo-count]').textContent, /Refreshed library: 3/u);
		assert.equal(mounted.dom.find('[data-photo-id="a"]'), null); assert.equal(session.writes.length, 1);
		assert.equal(mounted.button('Auto advance').hasAttribute('disabled'), false);
		assert.equal(mounted.button('Auto advance').getAttribute('aria-pressed'), 'true');
	} finally {
		saved.resolve(updated('a', 5)); refresh.resolve(page()); await mounted.flush(); await mounted.dispose();
	}
});

test('actual App preserves selection after save failure and after a saved edit whose query refresh fails', async () => {
	const session = owner(), mounted = await mount(session.factory); let queries = 0;
	session.port.readQueryStep = async () => {
		if (++queries > 2) throw new Error('query refresh failed'); return { ...page(), scanned: 4 };
	};
	try {
		await mounted.activateQuery(); await mounted.photoClick('a'); await mounted.menu('Auto advance');
		session.saveRating = async () => { throw new Error('durable save failed'); };
		await mounted.key('a', '2'); assert.deepEqual(mounted.selected(), ['a']); assert.equal(mounted.focused(), 'a');
		assert.match(mounted.dom.one('[role="alert"]').textContent, /durable save failed/u);
		assert.match(mounted.photo('a').textContent, /Rating: 0/u); assert.equal(queries, 2);
		session.saveRating = async (id, rating) => updated(id, rating);
		await mounted.key('a', '4'); assert.match(mounted.photo('a').textContent, /Rating: 4/u);
		assert.deepEqual(mounted.selected(), ['a']); assert.equal(mounted.focused(), 'a'); assert.equal(queries, 3);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /query refresh failed/u);
		assert.match(mounted.dom.container.textContent, /The photo was saved, but the library could not be refreshed/u);
		assert.equal(mounted.dom.one('[data-photo-library]').getAttribute('aria-busy'), 'false');
	} finally { await mounted.dispose(); }
});

test('replacing the actual App factory aborts held culling and fences a late old saved row from the new generation', async () => {
	const saved = deferred<PhotoLibraryRowV1>(), first = owner(), second = owner(page(ROWS, 'New library'));
	first.saveRating = () => saved.promise;
	const mounted = await mount(first.factory);
	try {
		await mounted.menu('Show photo library'); await mounted.photoClick('a'); await mounted.menu('Auto advance');
		await mounted.key('a', '5'); assert.equal(first.writes.length, 1);
		await mounted.render(second.factory); assert.equal(first.writes[0]?.signal?.aborted, true);
		assert.deepEqual(mounted.selected(), []); assert.equal(first.closes(), 1);
		await mounted.menu('First page / refresh'); assert.match(mounted.dom.one('[data-photo-count]').textContent, /New library/u);
		await mounted.photoClick('c'); assert.deepEqual(mounted.selected(), ['c']);
		await mounted.flush(() => { saved.resolve(updated('a', 5)); });
		assert.deepEqual(mounted.selected(), ['c']); assert.equal(mounted.focused(), 'c');
		assert.match(mounted.photo('a').textContent, /Rating: 0/u); assert.equal(second.writes.length, 0);
		assert.match(mounted.dom.one('[data-photo-count]').textContent, /New library/u);
	} finally { saved.resolve(updated('a', 5)); await mounted.flush(); await mounted.dispose(); }
	assert.equal(second.closes(), 1);
});

function owner(initial = page()) {
	let opens = 0, closes = 0, previewReads = 0;
	const writes: { id: string; rating: number; signal: AbortSignal | undefined }[] = [];
	const fixture = {
		writes, saveRating: async (id: string, rating: number): Promise<PhotoLibraryRowV1> => updated(id, rating),
		opens: () => opens, closes: () => closes, previewReads: () => previewReads,
		factory: async (): Promise<PhotoLibrarySessionPortV1> => { opens++; return port; },
		get port() { return port; },
	};
	const unused = async (): Promise<never> => { throw new Error('This scalar culling fixture must not admit another feature.'); };
	const port: PhotoLibrarySessionPortV1 = {
		readBatchRenameSelection: unused,
		planBatchRename: (): never => { throw new Error('Unexpected batch rename plan in culling App fixture.'); },
		renamePhotos: unused, undoBatchRename: unused,
		readImportPresets: unused, applyImportPreset: unused, backupCatalog: unused,
		readPage: async () => initial,
		readQueryStep: async () => ({ ...initial, scanned: initial.rows.length }),
		rebuildQueryStep: unused, readDefinitionPage: unused,
		readDefinition: async (): Promise<never> => { throw new Error('Unexpected organization read in culling App fixture.'); },
		applyDefinition: async (): Promise<never> => { throw new Error('Unexpected organization write in culling App fixture.'); },
		readMemberships: async (): Promise<never> => { throw new Error('Unexpected membership read in culling App fixture.'); },
		applyMemberships: async (): Promise<never> => { throw new Error('Unexpected membership write in culling App fixture.'); },
		readPreview: async () => { previewReads++; throw new Error('Culling must not request pixels.'); },
		importFiles: unused,
		setRating: async (id, rating, options) => {
			writes.push({ id, rating, signal: options?.signal }); return fixture.saveRating(id, rating);
		},
		applyAttributes: unused, readMetadata: unused, applyMetadata: unused,
		close: async () => { closes++; },
	};
	return fixture;
}

type Modifiers = Readonly<{ ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }>;
async function mount(factory: CreatePhotoLibrarySessionV1, strict = false) {
	const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
		? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
	const dom = installReactTestDom(), global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = global.IS_REACT_ACT_ENVIRONMENT; global.IS_REACT_ACT_ENVIRONMENT = true;
	// The shell publishes a workspace event; the inert test window owns no site.
	Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
	const { default: App } = await import('../src/common/editor/ui/lightscaper/LightscaperApp.tsx');
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let unmounted = false;
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const render = async (next: CreatePhotoLibrarySessionV1) => {
		await flush(() => { root.render(strict ? <StrictMode><App locale="en" createSession={next} /></StrictMode> : <App locale="en" createSession={next} />); });
	};
	const button = (text: string): ReactTestElement => {
		const result = dom.container.querySelectorAll('button').find(node => node.textContent === text);
		assert.ok(result, `Missing actual App action ${text}`); return result;
	};
	const photo = (id: string) => dom.one(`[data-photo-id="${id}"]`);
	const click = async (target: ReactTestElement, modifiers: Modifiers = {}) => {
		assert.equal(target.hasAttribute('disabled'), false, 'the mounted action must be available');
		await flush(() => {
			target.focus(); reactProps(target).onFocus?.({ currentTarget: target });
			reactProps(target).onClick?.({ currentTarget: target, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers });
		});
	};
	const menu = async (text: string) => { await click(button(text)); };
	const dispose = async () => {
		try { if (!unmounted) { unmounted = true; await act(() => { root.unmount(); }); } await settle(); }
		finally { global.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); hooks.deregister(); }
	};
	try { await render(factory); } catch (error) { await dispose(); throw error; }
	return {
		dom, button, photo, menu, flush, render, dispose,
		selected: () => dom.container.querySelectorAll('[data-photo-id]').filter(node => node.getAttribute('aria-pressed') === 'true').map(node => node.getAttribute('data-photo-id')),
		focused: () => dom.container.ownerDocument.activeElement?.getAttribute('data-photo-id') ?? null,
		photoClick: async (id: string, modifiers?: Modifiers) => { await click(photo(id), modifiers); },
		focus: async (id: string) => { await flush(() => { const target = photo(id); target.focus(); reactProps(target).onFocus?.({ currentTarget: target }); }); },
		key: async (id: string, key: string, modifiers: Modifiers = {}) => {
			let prevented = 0;
			await flush(() => {
				const target = photo(id); target.focus(); reactProps(target).onFocus?.({ currentTarget: target });
				reactProps(target).onKeyDown?.({ key, currentTarget: target, ctrlKey: false, metaKey: false, shiftKey: false,
					...modifiers, preventDefault() { prevented++; } });
			});
			return prevented;
		},
		activateQuery: async () => {
			await menu('Show photo library'); await menu('Search, filter and sort');
			await flush(() => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); });
			await click(dom.one('[data-query-close]'));
		},
	};
}
