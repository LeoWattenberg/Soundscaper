/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { deferred, waitFor } from './helpers/async-test-control.ts';
import { harness, request } from './helpers/local-assistance-audio-publication-fixture.ts';

test('separation accepts with at most two bounded source writers and one ordered final project command', async (t) => {
	const fixture = harness(), gate = deferred<void>();
	let active = 0, maximum = 0;
	const begin = fixture.store.beginSourceWrite.bind(fixture.store);
	t.mock.method(fixture.store, 'beginSourceWrite', async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args), write = writer.write;
		return { ...writer, get framesWritten() { return writer.framesWritten; }, write: async (channels: readonly Float32Array[]) => {
			active += 1; maximum = Math.max(maximum, active);
			try { await gate.promise; await write(channels); } finally { active -= 1; }
		} };
	});
	const acceptance = fixture.acceptance.acceptValidatedResult(await request('source-separation'));
	try {
		await waitFor(() => active > 0, 'the first bounded publication writer'); await tick();
		assert.equal(active, 2); assert.equal(fixture.commits.length, 0);
	} finally { gate.resolve(); await acceptance; }
	assert.equal(maximum, 2); assert.equal(fixture.store.sources.size, 3); assert.equal(fixture.commits.length, 1);
	assert.deepEqual([...fixture.store.sources.keys()].sort(), ['assistance-dialogue-1', 'assistance-effects-9', 'assistance-music-5']);
});

test('a failed parallel source waits for its peer, stops further admissions, and rolls back all published sources', async (t) => {
	const fixture = harness(), first = deferred<void>(), peer = deferred<void>();
	let writes = 0, settled = false;
	const begin = fixture.store.beginSourceWrite.bind(fixture.store);
	t.mock.method(fixture.store, 'beginSourceWrite', async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args), write = writer.write;
		return { ...writer, get framesWritten() { return writer.framesWritten; }, write: async (channels: readonly Float32Array[]) => {
			writes += 1;
			if (args[0] === 'assistance-dialogue-1') { await first.promise; throw new Error('First source storage failed.'); }
			await peer.promise; await write(channels);
		} };
	});
	const work = fixture.acceptance.acceptValidatedResult(await request('source-separation'));
	const rejected = assert.rejects(work, /First source storage failed/iu);
	void rejected.then(() => { settled = true; });
	try {
		await waitFor(() => writes > 0, 'the first parallel publication write'); await tick(); assert.equal(writes, 2);
		first.resolve(); await tick(); await tick();
		assert.equal(settled, false); assert.equal(fixture.events.filter((event) => event.startsWith('begin:')).length, 2);
	} finally { first.resolve(); peer.resolve(); await rejected; }
	assert.equal(fixture.commits.length, 0); assert.equal(fixture.store.sources.size, 0);
	assert.deepEqual([...fixture.store.deleted].sort(), ['assistance-dialogue-1', 'assistance-music-5']);
});
