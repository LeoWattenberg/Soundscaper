/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useEffect } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const ROW = Object.freeze({ id: 'photo-1', fileName: 'Photo.png', width: 1, height: 1, rating: 0,
	flag: 'unflagged' as const, colorLabel: 'none' as const });
const RECEIPT = Object.freeze({ index: 0, fileName: ROW.fileName, photoId: ROW.id, status: 'imported' as const,
	reusedOriginal: false, message: null, hasMetadataNotices: false });
const page = (catalogName: string): PhotoLibraryPageV1 => Object.freeze({ catalogName, totalCount: 1,
	rows: Object.freeze([ROW]), cursor: null });

test('replacing a factory releases old busy and presentation state while a late old page cannot replace the new library', async () => {
	const oldPage = deferred<PhotoLibraryPageV1>();
	let oldSignal: AbortSignal | undefined, oldReads = 0;
	const first = owner(async options => {
		if (++oldReads === 1) return page('Old library');
		oldSignal = options?.signal;
		return oldPage.promise;
	});
	const second = owner(async () => page('New library'));
	const firstFactory = async () => first.port, secondFactory = async () => second.port;
	const mounted = await mount(firstFactory);
	let work: { pending: Promise<void> } | undefined;
	try {
		await act(async () => { await mounted.current.importFiles([new File(['x'], ROW.fileName)]); });
		assert.equal(mounted.current.page?.catalogName, 'Old library');
		assert.equal(mounted.current.receipts.length, 1);
		work = await mounted.start(() => mounted.current.readPage());
		assert.equal(mounted.current.busy, true);
		assert.equal(oldSignal?.aborted, false);

		await mounted.render(secondFactory);
		assert.equal(oldSignal?.aborted, true);
		assert.equal(first.closes(), 1);
		assert.equal(mounted.current.busy, false);
		const replacement = mounted.current;
		assert.equal(replacement.page, null);
		assert.deepEqual(replacement.receipts, []);
		assert.equal(replacement.error, null);
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(mounted.current.page?.catalogName, 'New library');
		await act(async () => { oldPage.resolve(page('Late old library')); await work!.pending; });
		assert.equal(mounted.current.page?.catalogName, 'New library');
		assert.equal(mounted.current.busy, false);
		assert.equal(first.closes(), 1);
	} finally {
		await act(async () => { oldPage.resolve(page('Cleanup')); await work?.pending; });
		await mounted.dispose();
	}
	assert.equal(second.closes(), 1);
});

test('unmount closes a factory owner resolving late without admitting the canceled requested action', async () => {
	const factoryResult = deferred<PhotoLibrarySessionPortV1>();
	let reads = 0, opens = 0;
	const late = owner(async () => { reads++; return page('Late library'); });
	const mounted = await mount(() => { opens++; return factoryResult.promise; });
	let work: { pending: Promise<void> } | undefined;
	try {
		work = await mounted.start(() => mounted.current.readPage());
		assert.equal(opens, 1);
		assert.equal(mounted.current.busy, true);
		await mounted.unmount();
		assert.equal(late.closes(), 0);
		await act(async () => { factoryResult.resolve(late.port); await work!.pending; });
		assert.equal(reads, 0);
		assert.equal(late.closes(), 1);
		assert.equal(mounted.current.page, null);
	} finally {
		await act(async () => { factoryResult.resolve(late.port); await work?.pending; });
		await mounted.dispose();
	}
});

test('the generation reset preserves busy for an operation admitted by the next effect', async () => {
	const result = deferred<PhotoLibraryPageV1>();
	let signal: AbortSignal | undefined;
	const active = owner(options => { signal = options?.signal; return result.promise; });
	const mounted = await mount(async () => active.port, { startFromEffect: true });
	try {
		assert.ok(signal, 'the effect started an actual session read');
		assert.equal(signal.aborted, false);
		assert.equal(mounted.current.busy, true, 'a generation reset must not erase the admitted action');
		const waiting = mounted.current;
		assert.equal(waiting.page, null);
		await act(async () => { result.resolve(page('Current library')); await mounted.effectWork(); });
		assert.equal(mounted.current.busy, false);
		assert.equal(mounted.current.page?.catalogName, 'Current library');
	} finally {
		await act(async () => { result.resolve(page('Cleanup')); await mounted.effectWork(); });
		await mounted.dispose();
	}
	assert.equal(active.closes(), 1);
});

test('StrictMode remains inert until an action requests one owner and cleanup closes it once', async () => {
	let opens = 0, reads = 0;
	const active = owner(async () => { reads++; return page('Requested library'); });
	const mounted = await mount(async () => { opens++; return active.port; }, { strict: true });
	try {
		assert.equal(opens, 0);
		assert.equal(active.closes(), 0);
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(opens, 1);
		assert.equal(reads, 1);
		assert.equal(mounted.current.page?.catalogName, 'Requested library');
		await mounted.unmount();
		assert.equal(active.closes(), 1);
		await mounted.unmount();
		assert.equal(active.closes(), 1);
	} finally { await mounted.dispose(); }
});

function owner(readPage: PhotoLibrarySessionPortV1['readPage']) {
	let closes = 0;
	const port: PhotoLibrarySessionPortV1 = {
		readPage,
		importFiles: async () => Object.freeze([RECEIPT]),
		setRating: async (_photoId, rating) => Object.freeze({ ...ROW, rating }),
		close: async () => { closes++; },
	};
	return { port, closes: () => closes };
}

async function mount(initialFactory: CreatePhotoLibrarySessionV1, options: Readonly<{ strict?: boolean; startFromEffect?: boolean }> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibraryWorkflow> | null = null;
	let effectPending: Promise<void> | null = null, unmounted = false;
	function Harness({ factory }: Readonly<{ factory: CreatePhotoLibrarySessionV1 }>) {
		const workflow = usePhotoLibraryWorkflow(factory);
		const { readPage } = workflow;
		state = workflow;
		useEffect(() => {
			if (options.startFromEffect) effectPending = readPage();
		}, [readPage]);
		return null;
	}
	const render = async (factory: CreatePhotoLibrarySessionV1) => {
		await act(async () => {
			const harness = <Harness factory={factory} />;
			root.render(options.strict ? <StrictMode>{harness}</StrictMode> : harness);
		});
	};
	const unmount = async () => {
		if (unmounted) return;
		unmounted = true;
		await act(async () => { root.unmount(); });
	};
	try { await render(initialFactory); }
	catch (failure) { await unmount(); dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; throw failure; }
	return {
		get current() { if (!state) throw new Error('Hook did not mount.'); return state; },
		render, unmount,
		effectWork: () => { if (!effectPending) throw new Error('Effect did not admit work.'); return effectPending; },
		async start(action: () => Promise<void>) {
			let pending: Promise<void> | undefined;
			await act(async () => { pending = action(); await Promise.resolve(); });
			if (!pending) throw new Error('Action did not start.');
			return { pending };
		},
		async dispose() {
			try { await unmount(); }
			finally { actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); }
		},
	};
}
