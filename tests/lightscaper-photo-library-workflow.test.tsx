/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useEffect } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryQueryV1, PhotoLibraryPageV1, PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { emptyPhotoMetadataV1 } from '../src/lightscaper/catalog/photo-metadata.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
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

test('metadata publication updates the existing row only after durable acknowledgment and factory replacement clears its snapshot', async () => {
	const active = owner(async () => page('Library'));
	const pending = deferred<Awaited<ReturnType<PhotoLibrarySessionPortV1['applyMetadata']>>>();
	active.port.applyMetadata = async () => pending.promise;
	const mounted = await mount(async () => active.port);
	let work: { pending: Promise<void> } | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); await mounted.current.readMetadata(ROW.id); });
		const snapshot = mounted.current.metadata;
		assert.ok(snapshot);
		work = await mounted.start(() => mounted.current.applyMetadata(ROW.id, snapshot.revision, { fileName: 'Renamed.png' }));
		assert.equal(mounted.current.page?.rows[0]?.fileName, ROW.fileName);
		assert.equal(mounted.current.metadata?.revision, 0);
		await act(async () => {
			pending.resolve({ ...snapshot, revision: 1, metadata: { ...snapshot.metadata, fileName: 'Renamed.png' } });
			await work!.pending;
		});
		assert.equal(mounted.current.page?.rows[0]?.fileName, 'Renamed.png');
		assert.equal(mounted.current.page?.rows[0]?.id, ROW.id);
		assert.equal(mounted.current.metadata?.revision, 1);
		await mounted.render(async () => owner(async () => page('Replacement')).port);
		assert.equal(mounted.current.metadata, null);
	} finally { await mounted.dispose(); }
});

test('background preview demand shares the foreground owner without resetting its busy state', async () => {
	const heldPage = deferred<PhotoLibraryPageV1>(); let opens = 0, previews = 0;
	const active = owner(async () => heldPage.promise);
	active.port.readPreview = async () => { previews++; return { outcome: 'missing' }; };
	const mounted = await mount(async () => { opens++; return active.port; });
	let work: { pending: Promise<void> } | undefined;
	try {
		work = await mounted.start(() => mounted.current.readPage());
		assert.equal(mounted.current.busy, true);
		const callback = mounted.current.readPreview;
		await act(async () => { assert.deepEqual(await callback(ROW.id, 'thumbnail'), { outcome: 'missing' }); });
		assert.equal(opens, 1); assert.equal(previews, 1); assert.equal(mounted.current.busy, true);
		await act(async () => { heldPage.resolve(page('Library')); await work!.pending; });
		assert.equal(mounted.current.readPreview, callback);
	} finally {
		await act(async () => { heldPage.resolve(page('Cleanup')); await work?.pending; });
		await mounted.dispose();
	}
});

test('factory replacement aborts preview demand and joins old native cleanup before opening the next owner', async () => {
	const first = owner(async () => page('First')), second = owner(async () => page('Second'));
	const draining = deferred<void>(), entered = deferred<void>();
	let oldSignal: AbortSignal | undefined, newOpens = 0;
	first.port.readPreview = async (_id, _tier, options) => {
		oldSignal = options?.signal; assert.ok(oldSignal); entered.resolve();
		await new Promise<void>(resolve => { oldSignal!.addEventListener('abort', () => { resolve(); }, { once: true }); });
		oldSignal.throwIfAborted(); return { outcome: 'missing' };
	};
	first.port.close = async () => draining.promise;
	const mounted = await mount(async () => first.port);
	let work: Promise<unknown> | undefined, replacement: Promise<unknown> | undefined;
	try {
		work = mounted.current.readPreview(ROW.id, 'thumbnail');
		const rejected = assert.rejects(work, { name: 'AbortError' });
		await entered.promise;
		await mounted.render(async () => { newOpens++; return second.port; });
		assert.equal(oldSignal?.aborted, true); await rejected;
		replacement = mounted.current.readPreview(ROW.id, 'thumbnail');
		assert.equal(await remainsPending(replacement), true); assert.equal(newOpens, 0);
		draining.resolve(); assert.deepEqual(await replacement, { outcome: 'missing' }); assert.equal(newOpens, 1);
	} finally { draining.resolve(); await replacement; await mounted.dispose(); }
});

test('rapid factory replacement preserves a failed native-drain barrier across a skipped middle owner', async () => {
	const first = owner(async () => page('First')), middle = owner(async () => page('Middle')), last = owner(async () => page('Last'));
	const draining = deferred<void>(); let middleOpens = 0, lastOpens = 0;
	first.port.close = async () => draining.promise;
	const mounted = await mount(async () => first.port);
	let second: Promise<unknown> | undefined, third: Promise<unknown> | undefined;
	try {
		await mounted.current.readPreview(ROW.id, 'thumbnail');
		await mounted.render(async () => { middleOpens++; return middle.port; });
		second = mounted.current.readPreview(ROW.id, 'thumbnail');
		const middleRejected = assert.rejects(second, /native cleanup failed/iu);
		await mounted.render(async () => { lastOpens++; return last.port; });
		third = mounted.current.readPreview(ROW.id, 'thumbnail');
		const lastRejected = assert.rejects(third, /native cleanup failed/iu);
		assert.equal(await remainsPending(third), true);
		draining.reject(new Error('native cleanup failed'));
		await Promise.all([middleRejected, lastRejected]);
		assert.equal(middleOpens, 0); assert.equal(lastOpens, 0);
	} finally {
		draining.resolve(); await Promise.allSettled([second, third]); await mounted.dispose();
	}
});

test('a factory that synchronously unmounts is registered before it can return a late resource owner', async () => {
	const active = owner(async () => page('Late'));
	let unmounted: Promise<void> | undefined;
	const mounted = await mount(() => { unmounted = mounted.unmount(); return Promise.resolve(active.port); });
	try {
		await assert.rejects(mounted.current.readPreview(ROW.id, 'thumbnail'), { name: 'AbortError' });
		await unmounted;
		await new Promise<void>(resolve => { setImmediate(resolve); });
		assert.equal(active.closes(), 1);
	} finally { await mounted.dispose(); }
});

const QUERY: PhotoLibraryQueryV1 = { text: 'late match', filter: null, sort: { field: 'file-name', direction: 'descending' } };

test('search drains empty continuation steps through real tasks and keeps only the first nonempty page', async () => {
	const active = owner(async () => page('Library')); let steps = 0, yielded = false;
	active.port.readQueryStep = async options => {
		assert.deepEqual(options.query, QUERY);
		if (++steps === 1) {
			setTimeout(() => { yielded = true; }, 0);
			return { ...page('Library'), rows: [], cursor: 'next-sparse', scanned: 64 };
		}
		assert.equal(yielded, true); assert.equal(options.cursor, 'next-sparse');
		return { ...page('Matched'), cursor: 'next-match', scanned: 64 };
	};
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => { await mounted.current.applyQuery(QUERY); });
		assert.equal(steps, 2); assert.equal(mounted.current.page?.catalogName, 'Matched');
		assert.equal(mounted.current.page?.rows.length, 1); assert.equal(mounted.current.page?.cursor, 'next-match');
		assert.deepEqual(Object.keys(mounted.current.page ?? {}).sort(), ['catalogName', 'cursor', 'rows', 'totalCount']);
		assert.deepEqual(mounted.current.query, QUERY);
	} finally { await mounted.dispose(); }
});

test('canceling a sparse search between persisted steps preserves the displayed library', async () => {
	const active = owner(async () => page('Unchanged')); let steps = 0;
	const mounted = await mount(async () => active.port);
	active.port.readQueryStep = async () => {
		steps++; setTimeout(() => { mounted.current.cancel(); }, 0);
		return { ...page('Searching'), rows: [], cursor: 'more-candidates', scanned: 64 };
	};
	try {
		await act(async () => { await mounted.current.readPage(); await mounted.current.applyQuery(QUERY); });
		assert.equal(steps, 1); assert.equal(mounted.current.page?.catalogName, 'Unchanged');
		assert.equal(mounted.current.query, null); assert.equal(mounted.current.busy, false); assert.equal(mounted.current.error, null);
	} finally { await mounted.dispose(); }
});

test('query index preparation is explicit, yields each bounded step and acknowledges accumulated scalar progress', async () => {
	const active = owner(async () => page('Library')); let steps = 0, yielded = false;
	active.port.readQueryStep = async () => { throw Object.assign(new Error('Index unavailable'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' }); };
	active.port.rebuildQueryStep = async () => {
		if (steps > 0) assert.equal(yielded, true);
		steps++; setTimeout(() => { yielded = true; }, 0);
		return { processed: steps < 3 ? 16 : 2, readBytes: 128, ready: steps === 3 };
	};
	const mounted = await mount(async () => active.port);
	try {
		assert.equal(steps, 0);
		await act(async () => { await mounted.current.probeQuery(); });
		assert.equal(mounted.current.needsQueryIndex, true); assert.equal(mounted.current.error, null); assert.equal(steps, 0);
		await act(async () => { await mounted.current.buildQueryIndex(); });
		assert.equal(steps, 3); assert.equal(mounted.current.needsQueryIndex, false);
		assert.deepEqual(mounted.current.queryIndexProgress, { processed: 34, readBytes: 384, ready: true });
	} finally { await mounted.dispose(); }
});

test('an import preserves the active query and refreshes its own cursor without calling the legacy pager', async () => {
	let legacyReads = 0, queryReads = 0;
	const active = owner(async () => { legacyReads++; return { ...page('Unfiltered'), cursor: 'legacy-cursor' }; });
	active.port.readQueryStep = async options => {
		queryReads++; assert.deepEqual(options.query, QUERY);
		return { ...page('Filtered'), cursor: 'query-cursor', scanned: 64 };
	};
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => { await mounted.current.applyQuery(QUERY); await mounted.current.importFiles([new File(['x'], 'New.png')]); });
		assert.equal(legacyReads, 0); assert.equal(queryReads, 2);
		assert.equal(mounted.current.page?.catalogName, 'Filtered'); assert.equal(mounted.current.page?.cursor, 'query-cursor');
		assert.deepEqual(mounted.current.query, QUERY);
	} finally { await mounted.dispose(); }
});

test('an acknowledged rating refreshes an active filter so its former member disappears', async () => {
	let rating = 0;
	const active = owner(async () => page('Library'));
	active.port.setRating = async (_id, next) => { rating = next; return { ...ROW, rating }; };
	active.port.readQueryStep = async () => ({ ...page('Rating filter'), rows: rating === 0 ? [ROW] : [], cursor: null, scanned: 1 });
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => {
			await mounted.current.applyQuery({ ...QUERY, text: '', filter: { kind: 'rating', value: 0 } });
			await mounted.current.setRating(ROW.id, 5);
		});
		assert.equal(rating, 5); assert.deepEqual(mounted.current.page?.rows, []); assert.equal(mounted.current.page?.cursor, null);
	} finally { await mounted.dispose(); }
});

test('an acknowledged filename edit refreshes the active global sort while retaining the same photo identity', async () => {
	let renamed = false;
	const active = owner(async () => page('Library'));
	const second = { ...ROW, id: 'photo-2', fileName: 'B.png' };
	active.port.readQueryStep = async () => ({ ...page('Sorted'), rows: renamed ? [second, { ...ROW, fileName: 'C.png' }]
		: [{ ...ROW, fileName: 'A.png' }, second], cursor: null, scanned: 2 });
	active.port.applyMetadata = async (_id, revision) => {
		renamed = true;
		return { photoId: ROW.id, revision: revision + 1, metadata: emptyPhotoMetadataV1('C.png'),
			extracted: null, originalFileName: ROW.fileName, originalSha256: 'a'.repeat(64) };
	};
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => {
			await mounted.current.applyQuery({ ...QUERY, text: '', sort: { field: 'file-name', direction: 'ascending' } });
			await mounted.current.applyMetadata(ROW.id, 0, { fileName: 'C.png' });
		});
		assert.deepEqual(mounted.current.page?.rows.map(row => [row.id, row.fileName]), [['photo-2', 'B.png'], [ROW.id, 'C.png']]);
		assert.equal(mounted.current.metadata?.revision, 1);
	} finally { await mounted.dispose(); }
});

test('a failed query refresh preserves the durable edit acknowledgment and invalidates its prior continuation', async () => {
	const active = owner(async () => page('Library')); let queryReads = 0;
	active.port.readQueryStep = async () => {
		if (++queryReads > 1) throw new Error('Query storage temporarily unavailable');
		return { ...page('Sorted'), cursor: 'old-query-cursor', scanned: 1 };
	};
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => {
			await mounted.current.applyQuery(QUERY);
			await mounted.current.applyMetadata(ROW.id, 0, { fileName: 'Acknowledged.png' });
		});
		assert.equal(mounted.current.metadata?.revision, 1);
		assert.equal(mounted.current.metadata?.metadata.fileName, 'Acknowledged.png');
		assert.equal(mounted.current.page?.rows[0]?.fileName, 'Acknowledged.png');
		assert.equal(mounted.current.page?.cursor, null);
		assert.equal(mounted.current.error, 'Query storage temporarily unavailable');
		assert.deepEqual(mounted.current.query, QUERY);
	} finally { await mounted.dispose(); }
});

test('an acknowledged import invalidates the active query continuation even when its refresh fails', async () => {
	const active = owner(async () => page('Library')); let queryReads = 0;
	active.port.readQueryStep = async () => {
		if (++queryReads > 1) throw new Error('Import query refresh failed');
		return { ...page('Filtered'), cursor: 'old-query-cursor', scanned: 1 };
	};
	const mounted = await mount(async () => active.port);
	try {
		await act(async () => {
			await mounted.current.applyQuery(QUERY);
			await mounted.current.importFiles([new File(['x'], 'New.png')]);
		});
		assert.deepEqual(mounted.current.receipts, [{ ...RECEIPT, fileName: 'New.png' }]);
		assert.equal(mounted.current.page?.cursor, null);
		assert.equal(mounted.current.error, 'Import query refresh failed');
	} finally { await mounted.dispose(); }
});

function owner(readPage: PhotoLibrarySessionPortV1['readPage']) {
	let closes = 0;
	const port: PhotoLibrarySessionPortV1 = {
		readBatchRenameSelection: async (): Promise<never> => { throw new Error('Unexpected batch rename selection in workflow fixture.'); },
		planBatchRename: (): never => { throw new Error('Unexpected batch rename plan in workflow fixture.'); },
		renamePhotos: async (): Promise<never> => { throw new Error('Unexpected batch rename in workflow fixture.'); },
		undoBatchRename: async (): Promise<never> => { throw new Error('Unexpected batch rename undo in workflow fixture.'); },
		readImportPresets: async (): Promise<never> => { throw new Error('Unexpected import preset read in workflow fixture.'); },
		applyImportPreset: async (): Promise<never> => { throw new Error('Unexpected import preset write in workflow fixture.'); },
		readPage,
		readQueryStep: async () => Object.freeze({ ...page('Library'), scanned: 1 }),
		rebuildQueryStep: async () => Object.freeze({ processed: 0, readBytes: 0, ready: true }),
		readDefinitionPage: async () => Object.freeze({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		readDefinition: async (): Promise<never> => { throw new Error('Unexpected organization read in workflow fixture.'); },
		applyDefinition: async (): Promise<never> => { throw new Error('Unexpected organization write in workflow fixture.'); },
		readMemberships: async (): Promise<never> => { throw new Error('Unexpected membership read in workflow fixture.'); },
		applyMemberships: async (): Promise<never> => { throw new Error('Unexpected membership write in workflow fixture.'); },
		readPreview: async () => Object.freeze({ outcome: 'missing' as const }),
		importFiles: async files => Object.freeze(files.map((file, index) => Object.freeze({ ...RECEIPT, index, fileName: file.name }))),
		setRating: async (_photoId, rating) => Object.freeze({ ...ROW, rating }),
		applyAttributes: async (_photoId, changes) => Object.freeze({ ...ROW, ...changes }),
		readMetadata: async () => Object.freeze({ photoId: ROW.id, revision: 0, metadata: emptyPhotoMetadataV1(ROW.fileName),
			extracted: null, originalFileName: ROW.fileName, originalSha256: 'a'.repeat(64) }),
		applyMetadata: async (_photoId, expectedRevision, changes) => Object.freeze({ photoId: ROW.id, revision: expectedRevision + 1,
			metadata: Object.freeze({ ...emptyPhotoMetadataV1(ROW.fileName), ...changes }), extracted: null,
			originalFileName: ROW.fileName, originalSha256: 'a'.repeat(64) }),
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
