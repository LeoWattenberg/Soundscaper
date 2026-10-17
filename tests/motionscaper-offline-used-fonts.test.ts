/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { replayDocumentApplicationFonts, replayUsedApplicationFonts } from '../src/common/offline/application-shell-used-fonts.ts';
import { registerOfflineApplicationShell } from '../src/common/offline/application-shell.ts';

const origin = 'https://motionscaper.org';
const font = `${origin}/assets/inter-latin-400-normal-Ab12_cd-.woff2`;
class WorkerContainer extends EventTarget {
	controller: { scriptURL: string } | null = null;
	listeners = 0;
	override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
		this.listeners += 1; super.addEventListener(...args);
	}
	override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
		this.listeners -= 1; super.removeEventListener(...args);
	}
	claim(scriptURL = `${origin}/service-worker.js`): void {
		this.controller = { scriptURL }; this.dispatchEvent(new Event('controllerchange'));
	}
}
function fixture(names: readonly string[] = [font]) {
	const worker = new WorkerContainer();
	const calls: string[] = [];
	const options = {
		serviceWorker: worker, origin, scriptUrl: '/service-worker.js',
		activeWorker: () => worker.controller,
		updatePending: () => false,
		resourceNames: () => names,
		fetch: async (url: string, init: RequestInit) => {
			assert.equal(init.cache, 'default'); assert.equal(init.redirect, 'error');
			assert.equal(init.credentials, 'same-origin'); assert.ok(init.signal);
			calls.push(url); return new Response(new Uint8Array([1]));
		},
		deadlineMs: 1_000,
	};
	return { worker, calls, options };
}

test('Motion first-load fonts replay only after own controller; completion awaits physical fetch', async () => {
	const { worker, calls, options } = fixture();
	let finish!: () => void;
	let complete = false;
	const request = replayUsedApplicationFonts({ ...options, fetch: async (...args) => {
		await new Promise<void>((resolve) => { finish = resolve; });
		return options.fetch(...args);
	} }).then((result) => { complete = true; return result; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, []);
	worker.claim('https://other.example/service-worker.js');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(complete, false);
	worker.claim();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(complete, false);
	finish();
	assert.deepEqual(await request, [font]);
	assert.deepEqual(calls, [font]);
	assert.equal(worker.listeners, 0);
});

test('Motion replay admits only bounded deduplicated prior-loaded immutable own fonts', async () => {
	const { worker, calls, options } = fixture([
		font, font, `${origin}/assets/helper-Ab12_cd-.js`, 'https://framescaper.org/assets/font-Ab12_cd-.woff2',
		`${origin}/fonts/font.woff2`, `${font}?unversioned=1`, `${font}#fragment`,
		`${origin}/assets/font.woff2`, `${origin}/assets/font-short.woff2`,
	]);
	worker.claim();
	await replayUsedApplicationFonts(options);
	assert.deepEqual(calls, [font]);
	const overflow = fixture(Array.from({ length: 33 }, (_, index) => `${origin}/assets/font${index}-Ab12_cd-.woff2`));
	overflow.worker.claim();
	await assert.rejects(replayUsedApplicationFonts(overflow.options), /font replay limit/u);
	assert.deepEqual(overflow.calls, []);
});

test('Motion font handoff rejects a same-URL stale controller and waits for current active ownership', async () => {
	const { worker, calls, options } = fixture();
	worker.claim();
	const active = { scriptURL: `${origin}/service-worker.js` };
	let pending = true;
	const replay = replayUsedApplicationFonts({ ...options, activeWorker: () => active, updatePending: () => pending });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, []);
	worker.controller = active;
	worker.dispatchEvent(new Event('controllerchange'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, []);
	pending = false;
	worker.dispatchEvent(new Event('controllerchange'));
	assert.deepEqual(await replay, [font]);
	assert.equal(worker.listeners, 0);
});

test('Motion replay cancels a controller wait and releases successful response bodies serially', async () => {
	const { worker, options } = fixture([font, `${origin}/assets/second-Ab12_cd-.woff2`]);
	const signal = new AbortController();
	const waiting = replayUsedApplicationFonts({ ...options, signal: signal.signal });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(worker.listeners, 1);
	signal.abort();
	await assert.rejects(waiting, { name: 'AbortError' });
	assert.equal(worker.listeners, 0);
	worker.claim();
	let fetched = 0;
	let released = 0;
	await replayUsedApplicationFonts({ ...options, fetch: async () => {
		assert.equal(fetched, released);
		fetched += 1;
		return new Response(new ReadableStream({ cancel() { released += 1; } }));
	} });
	assert.equal(released, 2);
});

test('Motion font replay captures pending font loads, removes listeners and cancels deadline work', async () => {
	const { worker, options } = fixture();
	let loaded = false;
	await assert.rejects(replayUsedApplicationFonts({ ...options, fontsReady: new Promise(() => {}), deadlineMs: 5 }), /timed out/u);
	assert.equal(worker.listeners, 0);
	const ready = Promise.resolve().then(() => { loaded = true; });
	worker.claim();
	assert.deepEqual(await replayUsedApplicationFonts({ ...options, fontsReady: ready, resourceNames: () => {
		assert.equal(loaded, true); return [font];
	} }), [font]);
	let signal: AbortSignal | undefined;
	await assert.rejects(replayUsedApplicationFonts({ ...options, deadlineMs: 5, fetch: (_url, init) => {
		signal = init.signal ?? undefined; return new Promise(() => {});
	} }), /timed out/u);
	assert.equal(signal?.aborted, true);
});

test('Motion font replay refuses failed fetch, controller loss, cancellation and foreign-controller timeout', async () => {
	const { worker, options } = fixture([font, `${origin}/assets/second-Ab12_cd-.woff2`]);
	worker.claim();
	await assert.rejects(replayUsedApplicationFonts({ ...options, fetch: async () => new Response(null, { status: 404 }) }), /font replay request/u);
	let count = 0;
	await assert.rejects(replayUsedApplicationFonts({ ...options, fetch: async () => {
		count += 1; worker.claim(`${origin}/foreign-worker.js`); return new Response(null);
	} }), /controller changed/u);
	assert.equal(count, 1);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(replayUsedApplicationFonts({ ...options, signal: abort.signal }), { name: 'AbortError' });
	await assert.rejects(replayUsedApplicationFonts({ ...options, deadlineMs: 5 }), /timed out/u);
	assert.equal(worker.listeners, 0);
});

test('Motion document handoff publishes settled state and cancels pagehide work without changing registration', async () => {
	const events = new EventTarget();
	const dataset: Record<string, string> = {};
	const { worker } = fixture();
	worker.claim();
	const replacement: Record<string, unknown> = {
		document: { documentElement: { dataset }, fonts: { ready: Promise.resolve() } },
		location: new URL(origin), performance: { getEntriesByType: () => [{ name: font }] },
		addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
		fetch: async () => new Response(null),
	};
	const previous = new Map(Object.keys(replacement).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	try {
		for (const [key, value] of Object.entries(replacement)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		const registered = await registerOfflineApplicationShell({
			desktop: false, productId: 'motionscaper', builtProductId: 'motionscaper', location: new URL(origin),
			serviceWorker: Object.assign(worker, { register: async () => ({ active: worker.controller }) }),
		});
		assert.equal(registered.status, 'registered');
		assert.equal(dataset.offlineUsedFonts, 'complete');
		assert.equal(dataset.offlineUsedFontUrls, JSON.stringify([font]));
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (_input, options) => { signal = options?.signal; return new Promise(() => {}); };
		const pending = replayDocumentApplicationFonts(worker, { active: worker.controller }, '/service-worker.js');
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(dataset.offlineUsedFonts, 'pending');
		events.dispatchEvent(new Event('pagehide'));
		await pending;
		assert.equal(signal?.aborted, true);
		assert.equal(dataset.offlineUsedFonts, 'failed');
		assert.equal(dataset.offlineUsedFontUrls, undefined);
		assert.equal(worker.listeners, 0);
	} finally {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});

test('Motion malformed font replay identity cannot retain caller abort listeners', async () => {
	const { options } = fixture();
	const abort = new AbortController(); let listeners = 0;
	const add = abort.signal.addEventListener.bind(abort.signal), remove = abort.signal.removeEventListener.bind(abort.signal);
	abort.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => { listeners += 1; add(...args); };
	abort.signal.removeEventListener = (...args: Parameters<AbortSignal['removeEventListener']>) => { listeners -= 1; remove(...args); };
	await assert.rejects(replayUsedApplicationFonts({ ...options, signal: abort.signal, scriptUrl: 'http://[', deadlineMs: 5 }), TypeError);
	assert.equal(listeners, 0);
});
