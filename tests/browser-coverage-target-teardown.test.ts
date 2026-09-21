/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';

const ORIGIN = 'http://127.0.0.1:4322';

test('a closed page makes only its rejected pending source read irrelevant', async () => {
	const source = deferred();
	const target = fakeTarget('soundscaper-transient://page.js', source.promise);
	const collector = coverageCollector();
	assert.ok(collector);
	collector.attach(target.context);
	await target.sourceRequested;
	target.close();
	const collection = collector.collect('closed page source read', new Set());
	source.reject(new Error('Protocol error: target page, context or browser has been closed'));
	assert.equal(await collection, null);
});

test('a live page source-read rejection still fails coverage closed', async () => {
	const source = deferred();
	const target = fakeTarget('soundscaper-live://page.js', source.promise);
	const collector = coverageCollector();
	assert.ok(collector);
	collector.attach(target.context);
	await target.sourceRequested;
	const collection = collector.collect('live page source read', new Set());
	source.reject(new Error('live source capture failed'));
	await assert.rejects(collection, /live source capture failed/u);
});

test('portable collection excludes browser-internal profiles before dynamic admission', async () => {
	const url = 'chrome-error://chromewebdata/';
	const target = fakeTarget(url, Promise.resolve({ scriptSource: 'browser-owned' }), [coverage(url)]);
	const collector = coverageCollector({ portable: true });
	assert.ok(collector);
	collector.attach(target.context);
	await collector.settle();
	assert.equal(await collector.collect('browser error page', new Set()), null);
	assert.equal(target.sourceReadCount(), 0);
});

test('an application sourceURL cannot masquerade as a browser-internal profile', async () => {
	const url = 'chrome-error://chromewebdata/';
	const target = fakeTarget(url, Promise.resolve({ scriptSource: 'application-owned' }), [coverage(url)], true);
	const collector = coverageCollector({ portable: true });
	assert.ok(collector);
	collector.attach(target.context);
	await assert.rejects(
		collector.collect('spoofed browser error page', new Set()),
		/unapproved dynamic script chrome-error:\/\/chromewebdata\//u,
	);
	assert.equal(target.sourceReadCount(), 1);
});

function coverageCollector({ portable = false } = {}) {
	const site = { origin: ORIGIN, outputDirectory: process.cwd(), productId: 'soundscaper' as const };
	return createBrowserCoverageCollector({
		browserName: 'chromium',
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			...(portable ? { SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([site]) } : {}),
		},
		sites: [site],
	});
}

function fakeTarget(
	url: string,
	sourceReply: Promise<unknown>,
	finalCoverage: unknown[] = [],
	hasSourceURL = false,
) {
	let closed = false;
	let resolveSourceRequested!: () => void;
	let sourceReads = 0;
	const sourceRequested = new Promise<void>((resolve) => { resolveSourceRequested = resolve; });
	const session = Object.assign(new EventEmitter(), {
		async detach() {},
		async send(method: string) {
			if (method === 'Debugger.enable') queueMicrotask(() => {
				session.emit('Debugger.scriptParsed', { hasSourceURL, scriptId: 'script', url });
			});
			if (method === 'Debugger.getScriptSource') {
				sourceReads += 1;
				resolveSourceRequested();
				return sourceReply;
			}
			if (method === 'Profiler.takePreciseCoverage') return { result: finalCoverage };
			return {};
		},
	});
	const browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { throw new Error('No worker target expected.'); },
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	const browser = {
		_connection: { toImpl: () => browserImplementation },
		async newBrowserCDPSession() {},
	};
	const page = { context: () => context, isClosed: () => closed };
	const context = {
		browser: () => browser,
		newCDPSession: async () => session,
		on() {},
		pages: () => [page],
	};
	return {
		close: () => { closed = true; },
		context,
		sourceReadCount: () => sourceReads,
		sourceRequested,
	};
}

function coverage(url: string) {
	return {
		functions: [{
			functionName: '',
			isBlockCoverage: true,
			ranges: [{ count: 1, endOffset: 1, startOffset: 0 }],
		}],
		scriptId: 'script',
		url,
	};
}

function deferred() {
	let reject!: (error: Error) => void;
	let resolve!: (value: unknown) => void;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		reject = rejectPromise;
		resolve = resolvePromise;
	});
	return { promise, reject, resolve };
}
