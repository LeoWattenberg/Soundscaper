/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React, { act, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePhotoLibrarySelection, type PhotoLibrarySelectionOptionsV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-selection.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const PAGE: PhotoLibraryPageV1 = Object.freeze({ catalogName: 'Library', totalCount: 3, cursor: null,
	rows: Object.freeze(['a', 'b', 'c'].map(id => Object.freeze({ id, fileName: `${id}.png`, width: 1, height: 1,
		rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
const OPTIONS: PhotoLibrarySelectionOptionsV1 = { photoIds: ['a', 'b', 'c'], generation: 'library', pageIdentity: PAGE, autoAdvance: true };

test('StrictMode selection stays inert and native focus preserves a multi-selection while navigation delivers focus', async () => {
	const mounted = await mount();
	try {
		assert.deepEqual(mounted.current.snapshot.selectedIds, []);
		await act(() => { mounted.current.select('a'); mounted.current.select('c', { toggle: true }); mounted.current.focus('b'); });
		assert.deepEqual(mounted.current.snapshot.selectedIds, ['a', 'c']); assert.equal(mounted.current.snapshot.focusedId, 'b');
		assert.equal(mounted.dom.one('[data-photo-id="b"]').ownerDocument.activeElement, mounted.dom.one('[data-photo-id="b"]'));
		await act(() => { mounted.current.navigate('b', 'ArrowRight'); });
		assert.deepEqual(mounted.current.snapshot.selectedIds, ['c']);
		assert.equal(mounted.dom.one('[data-photo-id="c"]').ownerDocument.activeElement, mounted.dom.one('[data-photo-id="c"]'));
	} finally { await mounted.dispose(); }
});

test('a saved receipt advances the button focus, while refresh-failed pauses it and a disabled advance stays put', async () => {
	const mounted = await mount();
	try {
		await act(async () => { mounted.current.select('a'); await mounted.current.cull('a', async () => ({ outcome: 'saved', photoId: 'a', page: PAGE, notice: null })); });
		assert.equal(mounted.current.snapshot.primaryId, 'b');
		assert.equal(mounted.dom.one('[data-photo-id="b"]').ownerDocument.activeElement, mounted.dom.one('[data-photo-id="b"]'));
		await act(async () => { await mounted.current.cull('b', async () => ({ outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' })); });
		assert.equal(mounted.current.snapshot.primaryId, 'b'); assert.equal(mounted.current.notice, 'refresh-failed');
		await mounted.render({ ...OPTIONS, autoAdvance: false });
		await act(async () => { await mounted.current.cull('b', async () => ({ outcome: 'saved', photoId: 'b', page: PAGE, notice: null })); });
		assert.equal(mounted.current.snapshot.primaryId, 'b');
	} finally { await mounted.dispose(); }
});

test('generation replacement aborts the old observer, joins one pending job, and fences its late acknowledgement', async () => {
	const result = deferred<PhotoLibraryCullReceiptV1>(), mounted = await mount(); let signal: AbortSignal | undefined;
	let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { mounted.current.select('a'); work = mounted.current.cull('a', async current => { signal = current; return result.promise; }); await Promise.resolve(); });
		assert.equal(signal?.aborted, false); assert.equal(mounted.current.pendingPhotoId, 'a');
		await mounted.render({ ...OPTIONS, generation: 'replacement' }); assert.equal(signal?.aborted, true);
		await act(async () => { assert.deepEqual(await mounted.current.cull('b', async () => ({ outcome: 'failed' })), { outcome: 'busy' }); });
		await act(async () => { result.resolve({ outcome: 'saved', photoId: 'a', page: PAGE, notice: null }); await work; });
		assert.deepEqual(mounted.current.snapshot.selectedIds, []); assert.equal(mounted.current.pendingPhotoId, null);
	} finally { result.resolve({ outcome: 'cancelled' }); await work; await mounted.dispose(); }
});

test('generation replacement clears scalar selection before a new observer can steal focus back to an old row', async () => {
	const mounted = await mount();
	try {
		await act(() => { mounted.current.select('b'); }); mounted.dom.container.focus();
		await mounted.render({ ...OPTIONS, generation: 'replacement' });
		assert.equal(mounted.current.snapshot.focusedId, null);
		assert.equal(mounted.dom.container.ownerDocument.activeElement, mounted.dom.container);
	} finally { await mounted.dispose(); }
});

test('unmount detaches targets and rejects later demands while preserving an already acknowledged write', async () => {
	const result = deferred<PhotoLibraryCullReceiptV1>(), mounted = await mount(); let signal: AbortSignal | undefined;
	let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { mounted.current.select('a'); work = mounted.current.cull('a', async current => { signal = current; return result.promise; }); await Promise.resolve(); });
		const stale = mounted.current; await mounted.unmount(); assert.equal(signal?.aborted, true);
		result.resolve({ outcome: 'saved', photoId: 'a', page: PAGE, notice: null }); assert.equal((await work!).outcome, 'saved');
		assert.deepEqual(await stale.cull('a', async () => { throw new Error('unmounted port called'); }), { outcome: 'cancelled' });
	} finally { result.resolve({ outcome: 'cancelled' }); await work; await mounted.dispose(); }
});

test('the native hook fixture has no default preview surfaces or auto advance and exercises the canonical TS closure', async () => {
	const styles = new Set(['photo-preview.css', 'photo-culling.css'].map(file => new URL(`../src/common/editor/ui/lightscaper/${file}`, import.meta.url).href));
	const loader = registerHooks({ load(url, context, next) {
		return styles.has(url) ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
	} });
	try {
		const { CullingNativeHarnessV1 } = await import('./helpers/lightscaper-culling-native-fixture.tsx');
		const html = renderToStaticMarkup(<CullingNativeHarnessV1 />);
		assert.doesNotMatch(html, /<canvas/u); assert.match(html, /data-photo-layout="grid"/u);
		assert.match(html, /aria-pressed="false">Auto advance/u);
		assert.equal((html.match(/aria-label="Photo \d+\.png"/gu) ?? []).length, 64);
		assert.doesNotMatch(html, /originalSha256|storageKey/u);
	} finally { loader.deregister(); }
});

async function mount() {
	const dom = installReactTestDom(), global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, prior = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibrarySelection> | null = null, unmounted = false;
	function Harness({ options }: Readonly<{ options: PhotoLibrarySelectionOptionsV1 }>) {
		const selection = usePhotoLibrarySelection(options); state = selection;
		return <div>{options.photoIds.map(id => <button key={id} data-photo-id={id} ref={button => { selection.attach(id, button); }}
			onFocus={() => { selection.focus(id); }} onClick={() => { selection.select(id); }}>{id}</button>)}</div>;
	}
	const render = async (options = OPTIONS) => { await act(() => { root.render(<StrictMode><Harness options={options} /></StrictMode>); }); };
	const unmount = async () => { if (unmounted) return; unmounted = true; await act(() => { root.unmount(); }); };
	await render();
	return { dom, render, unmount,
		get current() { if (!state) throw new Error('Selection hook did not mount.'); return state; },
		async click(id: string) { await act(() => { reactProps(dom.one(`[data-photo-id="${id}"]`)).onClick!(); }); },
		async dispose() { try { await unmount(); } finally { dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = prior; } },
	};
}
