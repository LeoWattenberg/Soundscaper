/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withTrackedBrowserContext } from './browser/helpers/tracked-browser-context.ts';

test('extra browser contexts settle page instrumentation and collect before close', async () => {
	const events: string[] = [];
	const context = { async newPage() { events.push('page'); return { name: 'page' }; }, async close() { events.push('close'); } };
	const collector = { attach(value: typeof context) { assert.equal(value, context); events.push('attach'); }, async settle() { events.push('settle'); }, async collect() { events.push('collect'); } };
	const result = await withTrackedBrowserContext({ createContext: async () => context, createCollector: () => collector }, async tracked => {
		assert.equal(tracked.context, context); const page = await tracked.newPage(); assert.equal(page.name, 'page'); events.push('navigate'); return 42;
	});
	assert.equal(result, 42); assert.deepEqual(events, ['attach', 'settle', 'page', 'settle', 'navigate', 'collect', 'close']);
});

test('coverage refusal and context close failure preserve the original workflow failure', async () => {
	const failures = [new Error('workflow'), new Error('coverage refuses unapproved WASM'), new Error('close')];
	await assert.rejects(withTrackedBrowserContext({
		createContext: async () => ({ async newPage() {}, async close() { throw failures[2]; } }),
		createCollector: () => ({ attach() {}, async settle() {}, async collect() { throw failures[1]; } }),
	}, () => Promise.reject(failures[0])), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, failures); return true;
	});
});

test('failed collector startup still releases its context, and unmeasured engines create no collector', async () => {
	let closed = 0; const failure = new Error('attach');
	const createContext = async () => ({ async newPage() { return 'page'; }, async close() { closed++; } });
	await assert.rejects(withTrackedBrowserContext({ createContext, createCollector: () => { throw failure; } }, async () => assert.fail('must not start')), error => error === failure);
	assert.equal(closed, 1);
	assert.equal(await withTrackedBrowserContext({ createContext, createCollector: () => null }, async tracked => tracked.newPage()), 'page');
	assert.equal(closed, 2);
});

test('owned browser release follows collection and context close even when either fails', async () => {
	const events: string[] = []; const failures = [new Error('collect'), new Error('context close'), new Error('browser close')];
	await assert.rejects(withTrackedBrowserContext({
		async createContext() { events.push('launch'); return { async newPage() {}, async close() { events.push('context close'); throw failures[1]; } }; },
		createCollector: () => ({ attach() {}, async settle() {}, async collect() { events.push('collect'); throw failures[0]; } }),
		async release() { events.push('browser close'); throw failures[2]; },
	}, async () => { events.push('work'); }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, failures); return true;
	});
	assert.deepEqual(events, ['launch', 'work', 'collect', 'context close', 'browser close']);
	let released = false; const refused = new Error('context setup');
	await assert.rejects(withTrackedBrowserContext({
		createContext: () => Promise.reject(refused), createCollector: () => null,
		async release() { released = true; },
	}, async () => assert.fail('context setup must finish first')), error => error === refused);
	assert.equal(released, true);
});
