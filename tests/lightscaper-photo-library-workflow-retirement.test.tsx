/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

test('explicit retirement synchronously fences actions and joins a late factory then native owner close', async () => {
	const factory = deferred<ReturnType<typeof createImportTestPort>>(), draining = deferred<void>();
	const owner = createImportTestPort(); let opens = 0, reads = 0, closes = 0;
	owner.readPage = async () => { reads++; return { catalogName: 'Library', totalCount: 0, rows: [], cursor: null }; };
	owner.close = async () => { closes++; await draining.promise; };
	const mounted = await mountImportWorkflow(() => { opens++; return factory.promise; });
	let read: Promise<void> | undefined, retiring: Promise<void> | undefined;
	try {
		await act(async () => { read = mounted.current.readPage(); await settle(); });
		retiring = mounted.current.retireAndJoin();
		assert.equal(mounted.current.retireAndJoin(), retiring);
		await mounted.current.readPage(); assert.equal(opens, 1); assert.equal(await remainsPending(retiring), true);
		await act(async () => { factory.resolve(owner); await read; await settle(); });
		assert.equal(reads, 0); assert.equal(closes, 1); assert.equal(await remainsPending(retiring), true);
		draining.resolve(); await retiring;
	} finally { factory.resolve(owner); draining.resolve(); await read; await retiring; await mounted.dispose(); }
	assert.equal(closes, 1);
});

test('failed explicit drain remains a replacement admission barrier across an unchanged-ID factory epoch', async () => {
	const first = createImportTestPort(), second = createImportTestPort(), failure = new Error('Native close failed.'); let nextOpens = 0;
	first.close = async () => { throw failure; };
	const mounted = await mountImportWorkflow(async () => first);
	try {
		await act(async () => { await mounted.current.readPage(); });
		await assert.rejects(mounted.current.retireAndJoin(), error => error === failure);
		await mounted.replace(async () => { nextOpens++; return second; });
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(nextOpens, 0); assert.match(mounted.current.error ?? '', /Native close failed/u);
	} finally { await mounted.dispose(); }
});

test('preview cleanup failure joins the native Session close and remains a replacement admission barrier', async () => {
	const presentation = deferred<void>(), closed = deferred<void>(), first = createImportTestPort(), second = createImportTestPort();
	const failure = new Error('Pixel staging cleanup failed.'); let closes = 0, nextOpens = 0;
	first.close = async () => { closes++; await closed.promise; };
	const mounted = await mountImportWorkflow(async () => first);
	let retiring: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); });
		retiring = mounted.current.retireAndJoin(presentation.promise); void retiring.catch(() => undefined);
		presentation.reject(failure); await settle(); assert.equal(closes, 1); assert.equal(await remainsPending(retiring), true);
		closed.resolve(); await assert.rejects(retiring, error => error === failure);
		await mounted.replace(async () => { nextOpens++; return second; });
		await act(async () => { await mounted.current.readPage(); }); assert.equal(nextOpens, 0);
		assert.match(mounted.current.error ?? '', /Pixel staging cleanup failed/u);
	} finally { closed.resolve(); presentation.resolve(); await retiring?.catch(() => undefined); await mounted.dispose(); }
});
