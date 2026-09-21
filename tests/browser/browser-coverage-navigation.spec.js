/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect } from './helpers/browser-coverage-fixture.js';

import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
} from '../../scripts/lib/browser-service-worker-coverage.mjs';
import {
	installNavigationCoverageCheckpoints,
	installPageOperationCoverageCheckpoints,
} from '../../scripts/lib/navigation-coverage-checkpoint.mjs';

const FIXTURE_URL = 'soundscaper-coverage-fixture://navigation.js';
const FIXTURE_SOURCE = `
globalThis.coverageBeforeNavigation = function coverageBeforeNavigation() { return 'before'; };
globalThis.coverageAfterNavigation = function coverageAfterNavigation() { return 'after'; };
//# sourceURL=${FIXTURE_URL}
`;
const WORKER_SOURCE = `
function coverageWorkerBeforeNavigation() { return 'worker-before'; }
const coverageWorkerStartupValue = coverageWorkerBeforeNavigation();
self.onmessage = () => self.postMessage(coverageWorkerStartupValue);
`;
const WORKLET_SOURCE = `
function coverageLaterQuantum() { return 'later'; }
class CoverageLifecycleProcessor extends AudioWorkletProcessor {
	process() {
		this.quanta = (this.quanta ?? 0) + 1;
		if (this.quanta === 1) this.port.postMessage('first-quantum');
		if (this.quanta === 2) {
			coverageLaterQuantum();
			this.port.postMessage('later-quantum');
		}
		return true;
	}
}
registerProcessor('coverage-lifecycle', CoverageLifecycleProcessor);
`;

// This spec owns a second precise-coverage session so it can inspect raw V8
// ranges directly. Do not put the suite-wide recorder on the same isolate.
test.use({ browserCoverage: false });

test('precise coverage retains execution on both sides of a reload', async ({ browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const session = await context.newCDPSession(page);
	const entries = [];
	await session.send('Profiler.enable');
	await session.send('Runtime.enable');
	await session.send('Page.enable');
	await session.send('Debugger.enable');
	await session.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
	const checkpoint = async () => {
		const { result } = await session.send('Profiler.takePreciseCoverage');
		entries.push(...result);
	};
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint,
		session,
	});
	const pageOperations = installPageOperationCoverageCheckpoints({ checkpoint, page });

	try {
		await page.goto('/privacy/');
		await page.evaluate((source) => { (0, eval)(source); }, FIXTURE_SOURCE);
		await page.evaluate(() => globalThis.coverageBeforeNavigation());
		await page.reload();
		await page.evaluate((source) => { (0, eval)(source); }, FIXTURE_SOURCE);
		await page.evaluate(() => globalThis.coverageAfterNavigation());
		await checkpoints.settle();
		entries.push(...(await session.send('Profiler.takePreciseCoverage')).result);
	} finally {
		pageOperations.dispose();
		await checkpoints.dispose();
		await session.send('Profiler.stopPreciseCoverage');
		await session.send('Profiler.disable');
		await session.send('Debugger.disable');
		await session.detach();
	}

	const fixtureEntries = entries.filter(({ url }) => url === FIXTURE_URL);
	expect(fixtureEntries.some((entry) => functionCount(entry, 'coverageBeforeNavigation') > 0)).toBe(true);
	expect(fixtureEntries.some((entry) => functionCount(entry, 'coverageAfterNavigation') > 0)).toBe(true);
});

test('precise coverage drains before a page closes without beforeunload', async ({ browserName, context }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const closingPage = await context.newPage();
	const session = await context.newCDPSession(closingPage);
	const entries = [];
	await session.send('Profiler.enable');
	await session.send('Runtime.enable');
	await session.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
	const pageOperations = installPageOperationCoverageCheckpoints({
		checkpoint: async () => {
			entries.push(...(await session.send('Profiler.takePreciseCoverage')).result);
		},
		page: closingPage,
	});

	await closingPage.evaluate((source) => { (0, eval)(source); }, FIXTURE_SOURCE);
	await closingPage.evaluate(() => globalThis.coverageBeforeNavigation());
	await closingPage.close({ runBeforeUnload: false });
	pageOperations.dispose();

	const fixtureEntries = entries.filter(({ url }) => url === FIXTURE_URL);
	expect(fixtureEntries.some((entry) => functionCount(entry, 'coverageBeforeNavigation') > 0)).toBe(true);
});

test('browser-target coverage starts before a dedicated worker executes', async ({ browser, browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const workerUrl = '/coverage-navigation-worker.js';
	const pageUrl = '/coverage-navigation-worker.html';
	await context.route(`**${pageUrl}`, (route) => route.fulfill({
		body: '<!doctype html><title>coverage worker</title>',
		contentType: 'text/html; charset=utf-8',
	}));
	await context.route(`**${workerUrl}`, (route) => route.fulfill({
		body: WORKER_SOURCE,
		contentType: 'text/javascript; charset=utf-8',
	}));
	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
		browser,
		targetTypes: ['worker'],
	});
	await collector.start();
	const session = await context.newCDPSession(page);
	await session.send('Runtime.enable');
	await session.send('Page.enable');
	await session.send('Debugger.enable');
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: (reason) => collector.checkpoint({
			releaseWorklets: reason === 'audio-context-close',
		}),
		session,
	});
	let capture;
	try {
		await page.goto(pageUrl);
		const outcome = await page.evaluate((url) => new Promise((resolve, reject) => {
			const worker = new Worker(url);
			globalThis.coverageNavigationWorker = worker;
			worker.onerror = (event) => reject(new Error(event.message));
			worker.onmessage = ({ data }) => resolve(data);
			worker.postMessage(null);
		}), workerUrl);
		expect(outcome).toBe('worker-before');
		await page.evaluate(() => globalThis.coverageNavigationWorker.terminate());
		await checkpoints.settle();
		capture = await collector.collect();
	} finally {
		if (!collector.collected()) await collector.collect();
		await checkpoints.dispose();
		await session.send('Debugger.disable');
		await session.detach();
	}

	expect(capture.targetCounts).toEqual({ worker: 1 });
	expect(capture.pausedTargetCounts).toEqual({ worker: 1 });
	expect(capture.entries.some((entry) => (
		entry.url.endsWith(workerUrl)
		&& functionCount(entry, 'coverageWorkerBeforeNavigation') > 0
	))).toBe(true);
});

test('worklet coverage drains before an AudioContext closes', async ({ browser, browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const pageUrl = '/coverage-navigation-worklet.html';
	await context.route(`**${pageUrl}`, (route) => route.fulfill({
		body: '<!doctype html><title>coverage worklet</title>',
		contentType: 'text/html; charset=utf-8',
	}));
	await page.goto(pageUrl);
	test.skip(!await page.evaluate(async () => {
		if (typeof globalThis.AudioContext !== 'function'
			|| typeof globalThis.AudioWorkletNode !== 'function') return false;
		const audioContext = new AudioContext();
		const supported = audioContext.audioWorklet !== undefined;
		await audioContext.close();
		return supported;
	}), 'AudioWorklet is unavailable.');
	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
		browser,
		targetTypes: ['worklet'],
	});
	await collector.start();
	const session = await context.newCDPSession(page);
	await session.send('Runtime.enable');
	await session.send('Page.enable');
	await session.send('Debugger.enable');
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: (reason) => collector.checkpoint({
			releaseWorklets: reason === 'audio-context-close',
		}),
		session,
	});
	let capture;
	try {
		const outcome = await page.evaluate(async (source) => {
			const audioContext = new AudioContext();
			const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
			await audioContext.audioWorklet.addModule(moduleUrl);
			const node = new AudioWorkletNode(audioContext, 'coverage-lifecycle');
			const ran = new Promise((resolve) => {
				node.port.onmessage = ({ data }) => { if (data === 'first-quantum') resolve(data); };
			});
			node.connect(audioContext.destination);
			await audioContext.resume();
			const result = await ran;
			await new Promise((resolve) => { setTimeout(resolve, 100); });
			await audioContext.close();
			return result;
		}, WORKLET_SOURCE);
		expect(outcome).toBe('first-quantum');
		await checkpoints.settle();
		capture = await collector.collect();
	} finally {
		if (!collector.collected()) await collector.collect();
		await checkpoints.dispose();
		await session.send('Debugger.disable');
		await session.detach();
	}

	expect(capture.targetCounts).toEqual({ worklet: 1 });
	expect(capture.entries.some((entry) => (
		functionCount(entry, 'coverageLaterQuantum') > 0
	))).toBe(true);
});

test('worklet coverage drains during offline rendering completion', async ({ browser, browserName, context, page }) => {
	test.skip(browserName !== 'chromium', 'V8 precise coverage is Chromium-only.');

	const pageUrl = '/coverage-navigation-offline-worklet.html';
	await context.route(`**${pageUrl}`, (route) => route.fulfill({
		body: '<!doctype html><title>coverage offline worklet</title>',
		contentType: 'text/html; charset=utf-8',
	}));
	await page.goto(pageUrl);
	test.skip(!await page.evaluate(() => {
		if (typeof globalThis.OfflineAudioContext !== 'function'
			|| typeof globalThis.AudioWorkletNode !== 'function') return false;
		return new OfflineAudioContext(1, 128, 48_000).audioWorklet !== undefined;
	}), 'OfflineAudioContext AudioWorklet is unavailable.');
	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
		browser,
		targetTypes: ['worklet'],
	});
	await collector.start();
	const session = await context.newCDPSession(page);
	await session.send('Runtime.enable');
	await session.send('Page.enable');
	await session.send('Debugger.enable');
	const checkpoints = await installNavigationCoverageCheckpoints({
		checkpoint: () => collector.checkpoint(),
		session,
	});
	let capture;
	try {
		await page.evaluate(async (source) => {
			const audioContext = new OfflineAudioContext(1, 4_800, 48_000);
			const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
			await audioContext.audioWorklet.addModule(moduleUrl);
			const node = new AudioWorkletNode(audioContext, 'coverage-lifecycle');
			node.connect(audioContext.destination);
			await audioContext.startRendering();
		}, WORKLET_SOURCE);
		await checkpoints.settle();
		capture = await collector.collect();
	} finally {
		if (!collector.collected()) await collector.collect();
		await checkpoints.dispose();
		await session.send('Debugger.disable');
		await session.detach();
	}

	expect(capture.targetCounts).toEqual({ worklet: 1 });
	expect(capture.entries.some((entry) => (
		functionCount(entry, 'coverageLaterQuantum') > 0
	))).toBe(true);
});

function functionCount(entry, functionName) {
	return entry.functions.find((candidate) => candidate.functionName === functionName)?.ranges[0]?.count ?? 0;
}
