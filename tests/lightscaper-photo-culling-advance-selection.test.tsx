/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibrarySelection, type PhotoLibrarySelectionOptionsV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-selection.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

interface Advance { readonly successorIds: readonly string[]; isCurrent(): boolean; captureNextPage(ids: readonly string[]): void }
const ids = Array.from({ length: 64 }, (_, index) => `photo-${index}`);
const page = (photoIds: readonly string[]): PhotoLibraryPageV1 => Object.freeze({ catalogName: 'Library', totalCount: 80,
	rows: Object.freeze(photoIds.map(id => Object.freeze({ id, fileName: `${id}.png`, width: 1, height: 1,
		rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))), cursor: null });
const initial = page(ids);
const options = { photoIds: ids, generation: Object.freeze({ library: 'first' }), pageIdentity: initial,
	autoAdvance: true, queryIdentity: Object.freeze({ query: 'first' }) };

test('StrictMode mounted row64 focuses the actual newly mounted successor only after joined saved publication', async () => {
	const mounted = await mount(), result = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
	const published = page(['newcomer', 'photo-64', 'photo-65']); let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(() => { mounted.current.select('photo-63'); });
		await act(async () => { work = mounted.current.cull('photo-63', async (_signal, advance?: Advance) => {
			entered.resolve(); assert.ok(advance); advance.captureNextPage(['photo-64', 'photo-65']); return result.promise;
		}); await Promise.resolve(); });
		await entered.promise; assert.equal(mounted.current.snapshot.primaryId, 'photo-63');
		await mounted.render({ ...options, photoIds: published.rows.map(row => row.id), pageIdentity: published });
		await act(async () => { result.resolve({ outcome: 'saved', photoId: 'photo-63', page: published, notice: null }); await work; });
		assert.equal(mounted.current.snapshot.primaryId, 'photo-64');
		assert.equal(mounted.dom.one('[data-photo-id="photo-64"]').ownerDocument.activeElement,
			mounted.dom.one('[data-photo-id="photo-64"]'));
	} finally { result.resolve({ outcome: 'cancelled' }); await work; await mounted.dispose(); }
});

test('query identity replacement fences the request even with identical page and library generation', async () => {
	const mounted = await mount(), result = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
	let request: Advance | undefined, work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(() => { mounted.current.select('photo-63'); });
		await act(async () => { work = mounted.current.cull('photo-63', async (_signal, advance?: Advance) => {
			entered.resolve(); assert.ok(advance); request = advance; advance.captureNextPage(['photo-64']); return result.promise;
		}); await Promise.resolve(); });
		await entered.promise; await mounted.render({ ...options, queryIdentity: Object.freeze({ query: 'replacement' }) });
		assert.equal(request!.isCurrent(), false); assert.equal(mounted.current.snapshot.primaryId, 'photo-63');
		await act(async () => { result.resolve({ outcome: 'saved', photoId: 'photo-63', page: page(['photo-64']), notice: null }); await work; });
		assert.equal(mounted.current.snapshot.primaryId, 'photo-63'); assert.deepEqual(mounted.current.snapshot.photoIds, ids);
	} finally { result.resolve({ outcome: 'cancelled' }); await work; await mounted.dispose(); }
});

test('harmless rerenders retain lookahead but generation retirement joins it and preserves late saved ACK', async () => {
	const mounted = await mount(), result = deferred<PhotoLibraryCullReceiptV1>(), entered = deferred<void>();
	let request: Advance | undefined, signal: AbortSignal | undefined, work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(() => { mounted.current.select('photo-63'); });
		await act(async () => { work = mounted.current.cull('photo-63', async (current, advance?: Advance) => {
			signal = current; entered.resolve(); assert.ok(advance); request = advance; advance.captureNextPage(['photo-64']); return result.promise;
		}); await Promise.resolve(); });
		await entered.promise; await mounted.render({ ...options }); assert.equal(request!.isCurrent(), true);
		await mounted.render({ ...options, generation: Object.freeze({ library: 'replacement' }) });
		assert.equal(signal?.aborted, true); assert.equal(request!.isCurrent(), false); assert.equal(await remainsPending(work!), true);
		await act(async () => { result.resolve({ outcome: 'saved', photoId: 'photo-63', page: page(['photo-64']), notice: null });
			assert.equal((await work!).outcome, 'saved'); });
		assert.deepEqual(mounted.current.snapshot.selectedIds, []); assert.equal(mounted.current.pendingPhotoId, null);
	} finally { result.resolve({ outcome: 'cancelled' }); await work; await mounted.dispose(); }
});

async function mount() {
	const dom = installReactTestDom(), environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibrarySelection> | undefined;
	function Harness({ value }: Readonly<{ value: PhotoLibrarySelectionOptionsV1 & Readonly<{ queryIdentity?: unknown }> }>) {
		state = usePhotoLibrarySelection(value); const selection = state;
		return <div>{value.photoIds.map(id => <button key={id} data-photo-id={id} ref={button => { selection.attach(id, button); }}
			onFocus={() => { selection.focus(id); }}>{id}</button>)}</div>;
	}
	const render = async (value: PhotoLibrarySelectionOptionsV1 & Readonly<{ queryIdentity?: unknown }> = options) => {
		await act(() => { root.render(<StrictMode><Harness value={value} /></StrictMode>); });
	};
	await render();
	return { dom, render, get current() { assert.ok(state); return state; },
		async dispose() { try { await act(() => { root.unmount(); }); } finally { dom.restore(); environment.IS_REACT_ACT_ENVIRONMENT = prior; } } };
}
