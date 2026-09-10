/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Aup4WorkerImportSession } from '../src/common/editor/aup4-worker-import-session.ts';
import type { Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { deferred } from './helpers/async-test-control.ts';

const source: Aup4ImportSourcePlan = { sourceId: 'one', frameCount: 65_537, channelCount: 1, sampleRate: 48_000,
	channelPlans: [{ frameCount: 65_537, outputFrames: 65_537, sampleRate: 48_000,
		blocks: [{ blockId: 1, start: 0, frameCount: 65_537 }] }] };

test('the worker accepts only sequential pulls and releases its reader on completion', async () => {
	let reads = 0;
	const session = new Aup4WorkerImportSession([source], (_block, _offset, count) => { reads += 1; return new Float32Array(count); });
	const check = () => undefined;
	await assert.rejects(session.next('one', 1, check), /Out-of-order/u);
	const first = await session.next('one', 0, check);
	assert.equal(first.channels[0]?.length, 65_536);
	assert.equal(reads, 1);
	await assert.rejects(session.next('one', 0, check), /Out-of-order/u);
	await assert.rejects(session.next('other', 1, check), /Out-of-order/u);
	assert.equal((await session.next('one', 1, check)).channels[0]?.length, 1);
	assert.equal((await session.next('one', 2, check)).done, true);
	await assert.rejects(session.next('one', 0, check), /Out-of-order/u);
	await session.close();
	await session.close();
});

test('closing during a pending read prevents publication and rejects additional pulls', async () => {
	const pending = deferred<Float32Array>();
	const session = new Aup4WorkerImportSession([source], () => pending.promise);
	const next = session.next('one', 0, () => undefined);
	await assert.rejects(session.next('one', 0, () => undefined), /unavailable/u);
	const closing = session.close();
	const failed = assert.rejects(next, /closed/u);
	pending.resolve(new Float32Array(65_536));
	await failed;
	await closing;
	await assert.rejects(session.next('one', 1, () => undefined), /unavailable/u);
});
