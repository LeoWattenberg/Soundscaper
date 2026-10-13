/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { replayUsedApplicationAssets } from '../src/common/offline/application-shell-used-assets.ts';
import { observeApplicationResources } from '../src/common/offline/application-shell-resource-observation.ts';
import { replayDocumentApplicationFonts } from '../src/common/offline/application-shell-used-fonts.ts';
const origin = 'https://framescaper.org';
const font = `${origin}/assets/inter-normal-Ab12_cd-.woff2`;
const script = `${origin}/assets/linked-preview-Ab12_cd-.js`;
const entry = (name: string, startTime = 1) => ({ name, entryType: 'resource', startTime, duration: 1, responseEnd: startTime + 1 });

test('Motion linked first load replays actual completed JavaScript and fonts before publishing settled asset state', async () => {
	const events = new EventTarget(), resources = new EventTarget();
	const dataset: Record<string, string> = {}, calls: string[] = [];
	let disconnected = 0;
	const worker = Object.assign(new EventTarget(), { controller: { scriptURL: `${origin}/service-worker.js` } });
	class Observer {
		observe(): void {} disconnect(): void { disconnected += 1; } takeRecords() { return []; }
	}
	const replacement: Record<string, unknown> = {
		document: { documentElement: { dataset }, fonts: { ready: Promise.resolve() } }, location: new URL(origin),
		performance: Object.assign(resources, { getEntriesByType: () => [entry(font), entry(script)] }), PerformanceObserver: Observer,
		addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
		fetch: async (url: string) => { calls.push(url); return new Response(null); },
	};
	const previous = new Map(Object.keys(replacement).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	try {
		for (const [key, value] of Object.entries(replacement)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		await replayDocumentApplicationFonts(worker, { active: worker.controller }, '/service-worker.js');
		assert.deepEqual(calls, [font, script]);
		assert.equal(dataset.offlineUsedAssets, 'settled');
		assert.deepEqual(JSON.parse(dataset.offlineUsedAssetUrls!), [font, script]);
		assert.equal(dataset.offlineUsedFonts, 'complete');
		assert.deepEqual(JSON.parse(dataset.offlineUsedFontUrls!), [font]);
		assert.equal(disconnected, 1);
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (_url, options) => { signal = options?.signal; return new Promise(() => {}); };
		const pending = replayDocumentApplicationFonts(worker, { active: worker.controller }, '/service-worker.js');
		await new Promise(resolve => setImmediate(resolve)); events.dispatchEvent(new Event('pagehide')); await pending;
		assert.equal(disconnected, 2); assert.equal(signal?.aborted, true);
		assert.equal(dataset.offlineUsedAssets, 'failed'); assert.equal(dataset.offlineUsedAssetUrls, undefined);
	} finally {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
	}
});

function replayFixture() {
	const worker = Object.assign(new EventTarget(), { controller: null as { scriptURL: string } | null });
	const active = { scriptURL: `${origin}/service-worker.js` };
	const names = [script], calls: string[] = [];
	const claim = () => { worker.controller = active; worker.dispatchEvent(new Event('controllerchange')); };
	const options = { serviceWorker: worker, activeWorker: () => active, updatePending: () => false,
		origin, scriptUrl: '/service-worker.js', resourceNames: () => names, deadlineMs: 1000,
		fetch: async (url: string) => { calls.push(url); return new Response(null); } };
	return { worker, active, names, calls, claim, options };
}

test('Motion asset replay captures acquisition and in-flight completed resources while serializing physical requests', async () => {
	const f = replayFixture();
	const css = `${origin}/assets/editor-Ab12_cd-.css`, wasm = `${origin}/assets/renderer-Ab12_cd-.wasm`;
	let requests = 0, releases = 0;
	const replay = replayUsedApplicationAssets({ ...f.options, fetch: async (url) => {
		assert.equal(requests, releases); requests += 1; f.calls.push(url);
		if (url === script) f.names.push(wasm);
		return new Response(new ReadableStream({ cancel() { releases += 1; } }));
	} });
	await new Promise(resolve => setImmediate(resolve));
	f.worker.controller = { scriptURL: f.active.scriptURL }; // Same URL is not the active worker.
	f.worker.dispatchEvent(new Event('controllerchange'));
	await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.calls, []);
	f.names.push(css); f.claim();
	assert.deepEqual(await replay, [script, css, wasm]);
	assert.deepEqual(f.calls, [script, css, wasm]); assert.equal(releases, 3);
});

test('Motion asset handoff never fetches unused, foreign, unversioned or non-executable resources', async () => {
	const f = replayFixture(); f.claim();
	f.names.push(script, font, `${origin}/assets/never-image-Ab12_cd-.png`, `${origin}/unused.js`,
		`${origin}/other/assets/foreign-Ab12_cd-.js`, 'https://other.test/assets/foreign-Ab12_cd-.js',
		`${script}?version=x`, `${script}#x`, 'not a URL');
	assert.deepEqual(await replayUsedApplicationAssets(f.options), [script, font]);
	assert.deepEqual(f.calls, [script, font]);
});

test('Motion asset handoff refuses URL/entry caps before fetch and aborts stale, timed-out and failed requests', async () => {
	const f = replayFixture(); f.claim();
	await assert.rejects(replayUsedApplicationAssets({ ...f.options,
		resourceNames: () => Array.from({ length: 257 }, (_, i) => `${origin}/assets/code${i}-Ab12_cd-.js`) }), /limit/u);
	await assert.rejects(replayUsedApplicationAssets({ ...f.options, resourceNames: () => Array<string>(4097).fill(script) }), /observation limit/u);
	assert.deepEqual(f.calls, []);
	await assert.rejects(replayUsedApplicationAssets({ ...f.options, fetch: async () => new Response(null, { status: 404 }) }), /request failed/u);
	await assert.rejects(replayUsedApplicationAssets({ ...f.options, fetch: async () => {
		f.worker.controller = { scriptURL: f.active.scriptURL }; return new Response(null);
	} }), /controller changed/u);
	await assert.rejects(replayUsedApplicationAssets({ ...f.options, deadlineMs: 5 }), /timed out/u);
	f.claim(); let signal: AbortSignal | null | undefined;
	await assert.rejects(replayUsedApplicationAssets({ ...f.options, deadlineMs: 5, fetch: (_url, options) => {
		signal = options.signal; return new Promise(() => {});
	} }), /timed out/u);
	assert.equal(signal?.aborted, true);
});

function observationFixture() {
	const events = new EventTarget(); let listeners = 0, disconnected = 0;
	type Callback = (list: PerformanceObserverEntryList, observer: PerformanceObserver, options?: { droppedEntriesCount?: number }) => void;
	let callback!: Callback;
	let pending: PerformanceEntry[] = [];
	const entries: PerformanceEntry[] = [];
	class Observer {
		constructor(value: Callback) { callback = value; }
		observe(options: PerformanceObserverInit): void { assert.deepEqual(options, { type: 'resource', buffered: true }); }
		disconnect(): void { disconnected += 1; }
		takeRecords(): PerformanceEntryList { const values = pending; pending = []; return values; }
	}
	const performance = { getEntriesByType: () => entries,
		addEventListener: (...args: Parameters<EventTarget['addEventListener']>) => { listeners += 1; events.addEventListener(...args); },
		removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) => { listeners -= 1; events.removeEventListener(...args); },
	} as unknown as Performance;
	const observe = () => observeApplicationResources(performance, Observer as unknown as typeof PerformanceObserver);
	const item = (name: string, startTime = 1) => entry(name, startTime) as unknown as PerformanceEntry;
	return { observe, item, entries, events, counts: () => ({ listeners, disconnected }), queue: (value: PerformanceEntry) => pending.push(value),
		deliver: (values: PerformanceEntry[], droppedEntriesCount?: number) => callback({ getEntries: () => values } as PerformanceObserverEntryList,
			{} as PerformanceObserver, droppedEntriesCount === undefined ? {} : { droppedEntriesCount }) };
}

test('Motion resource observation includes retained and later completed entries without counting snapshot duplicates', () => {
	const f = observationFixture(); f.entries.push(f.item(script)); const watcher = f.observe();
	f.deliver([f.item(script)]); f.queue(f.item(font));
	assert.deepEqual(watcher.read(), [script, font]);
	assert.deepEqual(watcher.read(), [script, font]);
	watcher.dispose(); watcher.dispose();
	assert.deepEqual(f.counts(), { listeners: 0, disconnected: 1 });
	assert.throws(() => watcher.read(), /closed/u);
});

test('Motion resource observation refuses known dropped, overflowed, malformed and over-limit inventories', () => {
	for (const reason of ['dropped', 'buffer', 'malformed', 'limit', 'invalid-drop'] as const) {
		const f = observationFixture(), watcher = f.observe();
		if (reason === 'dropped') f.deliver([], 1);
		if (reason === 'invalid-drop') f.deliver([], NaN);
		if (reason === 'buffer') f.events.dispatchEvent(new Event('resourcetimingbufferfull'));
		if (reason === 'malformed') f.entries.push({ ...f.item(script), duration: NaN });
		if (reason === 'limit') f.entries.push(...Array.from({ length: 4097 }, (_, i) => f.item(script, i)));
		assert.throws(() => watcher.read(), /overflow|Malformed/u);
		watcher.dispose(); assert.deepEqual(f.counts(), { listeners: 0, disconnected: 1 });
	}
});

test('Motion used assets admit real dotted Vite locale and worker basenames within one immutable path component', async () => {
	const f = replayFixture(); f.claim();
	const locale = `${origin}/assets/hi.json-CgAX4hYx.js`, dotted = `${origin}/assets/motion.preview-worker-Ab12_cd-.js`;
	f.names.push(locale, dotted, `${origin}/assets/nested/hi.json-CgAX4hYx.js`,
		`${origin}/assets/../hi.json-CgAX4hYx.js`, `${locale}?v=1`, `${locale}#x`,
		'https://other.test/assets/hi.json-CgAX4hYx.js', `${origin}/assets/hi.json.js`, `${origin}/assets/hi.json-CgAX4hYx.zip`);
	assert.deepEqual(await replayUsedApplicationAssets(f.options), [script, locale, dotted]);
	assert.deepEqual(f.calls, [script, locale, dotted]);
});
