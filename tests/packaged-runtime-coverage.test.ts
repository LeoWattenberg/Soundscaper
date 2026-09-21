/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { WORKLET_COVERAGE_CHECKPOINT_URL } from '../scripts/lib/browser-service-worker-coverage.mjs';
import {
	createPackagedRuntimeCoverageCollector,
	packagedRuntimeCoverageLaunch,
} from './browser/helpers/packaged-runtime-coverage.js';
import {
	requestPackagedRuntimeShutdown,
} from './browser/helpers/packaged-runtime-process.js';

test('packaged coverage is opt-in and NODE_V8_COVERAGE reaches only the product child', () => {
	const runRoot = join(tmpdir(), 'soundscaper-nightly-run');
	const coverageDirectory = join(runRoot, 'coverage/v8-packaged');
	const ordinaryEnvironment = {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/coverage',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	};
	assert.deepEqual(packagedRuntimeCoverageLaunch(ordinaryEnvironment), {
		coverageDirectory: null,
		environment: { SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot },
	});
	assert.deepEqual(ordinaryEnvironment, {
		ELECTRON_RUN_AS_NODE: '1',
		NODE_V8_COVERAGE: '/outer/coverage',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	}, 'the outer Playwright environment is not mutated');

	const enabled = packagedRuntimeCoverageLaunch({
		...ordinaryEnvironment,
		SCAPE_BROWSER_COVERAGE: '1',
	});
	assert.equal(enabled.coverageDirectory, coverageDirectory);
	assert.deepEqual(enabled.environment, {
		NODE_V8_COVERAGE: coverageDirectory,
		SCAPE_BROWSER_COVERAGE: '1',
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
	});
	assert.throws(
		() => packagedRuntimeCoverageLaunch({ SCAPE_BROWSER_COVERAGE: '1' }),
		/SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT/u,
	);
});

test('packaged coverage records renderer, preload, and a final worker delta banked before detach', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-coverage-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const executablePath = join(tmpdir(), 'Soundscaper', 'soundscaper');
	const productUrl = 'soundscaper-app://bundle/';
	const preloadUrl = 'file:///opt/Soundscaper/resources/app.asar/preload.mjs';
	const sandboxPreloadUrl = '/opt/Soundscaper/resources/app.asar/desktop/soundscaper-project-library-sandbox-preload.cjs';
	const diagnosticUrl = 'http://127.0.0.1:4567/assets/diagnostic.js';
	const workerUrl = 'soundscaper-app://bundle/assets/peaks-worker.js';
	const page = new FakePage(productUrl, [
		coverageEntry('11', productUrl, 120),
		coverageEntry('12', preloadUrl, 80),
		coverageEntry('13', sandboxPreloadUrl, 70),
		coverageEntry('15', 'chrome-extension://playwright/internal.js', 40),
	], [coverageEntry('21', workerUrl, 50)]);
	const diagnosticPage = new FakePage(
		'http://127.0.0.1:4567/',
		[coverageEntry('31', diagnosticUrl, 60)],
	);
	const browserContext = new FakeContext([page, diagnosticPage]);
	const collector = createPackagedRuntimeCoverageCollector({
		architecture: 'x64',
		baseURL: 'http://127.0.0.1:4567/',
		context: browserContext,
		coverageDirectory: directory,
		executablePath,
		platform: 'linux',
		productId: 'soundscaper',
	});

	await collector.start();
	assert.equal(page.reloadCount, 1, 'the loaded app is reloaded after precise coverage starts');
	assert.equal(diagnosticPage.reloadCount, 1, 'the existing diagnostic window is measured from a reload too');
	assert.equal(
		page.calls.filter((method) => method === 'Profiler.startPreciseCoverage').length,
		1,
		'the existing page has one recorder even when product-page discovery finds it again',
	);
	assert.ok(
		page.calls.indexOf('Profiler.startPreciseCoverage') < page.calls.indexOf('Page.reload'),
		'the reload cannot race ahead of coverage',
	);
	const profilePath = await collector.collect();
	assert.ok(profilePath);
	const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
		result: Array<{ url: string }>;
		'script-source-cache': Record<string, string>;
		'soundscaper-packaged-runtime': Record<string, unknown>;
	};
	assert.deepEqual(profile.result.map(({ url }) => url), [
		productUrl,
		preloadUrl,
		sandboxPreloadUrl,
		workerUrl,
		diagnosticUrl,
	]);
	assert.deepEqual(Object.keys(profile['script-source-cache']), [
		productUrl,
		preloadUrl,
		sandboxPreloadUrl,
		workerUrl,
		diagnosticUrl,
	]);
	assert.deepEqual(profile['soundscaper-packaged-runtime'], {
		appOrigin: 'soundscaper-app://bundle',
		architecture: 'x64',
		baseOrigin: 'http://127.0.0.1:4567',
		captureKind: 'cdp-precise-coverage',
		capturesChildTargets: true,
		childTargetStrategy: 'recursive-auto-attach-paused',
		executablePath,
		pausedTargetCounts: { worker: 1 },
		platform: 'linux',
		productId: 'soundscaper',
		schemaVersion: 1,
		targetCounts: { worker: 1 },
		targetTypes: ['worker'],
	});
	assert.deepEqual(await readdir(directory), [basename(profilePath)]);
	assert.ok(page.calls.includes('Profiler.stopPreciseCoverage'));
	assert.ok(page.calls.includes('Profiler.disable'));
	assert.ok(page.calls.includes('Debugger.disable'));
	assert.ok(page.calls.includes('Target.setAutoAttach'));
	assert.ok(page.calls.includes('Page.addScriptToEvaluateOnNewDocument'));
	assert.ok(page.calls.includes('child:Profiler.startPreciseCoverage'));
	assert.ok(page.calls.includes('child:Runtime.runIfWaitingForDebugger'));
	assert.equal(page.calls.includes('child:Profiler.takePreciseCoverage'), false,
		'the detached worker survives only through its triggered delta');
	assert.ok(page.calls.includes('CDP.detach'));
});

test('packaged coverage checkpoints an audio worklet at its first render quantum', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-worklet-coverage-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const productUrl = 'soundscaper-app://bundle/';
	const workletUrl = 'soundscaper-app://bundle/assets/audio-worklet.js';
	const page = new FakePage(
		productUrl,
		[coverageEntry('11', productUrl, 120)],
		[coverageEntry('21', workletUrl, 50)],
		'worklet',
	);
	const collector = createPackagedRuntimeCoverageCollector({
		architecture: 'x64',
		baseURL: 'http://127.0.0.1:4567/',
		context: new FakeContext([page]),
		coverageDirectory: directory,
		executablePath: join(tmpdir(), 'Soundscaper', 'soundscaper'),
		platform: 'linux',
		productId: 'soundscaper',
	});

	await collector.start();
	const profilePath = await collector.collect();
	assert.ok(profilePath);
	const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
		result: Array<{ url: string }>;
		'soundscaper-packaged-runtime': {
			pausedTargetCounts: Record<string, number>;
			targetCounts: Record<string, number>;
			targetTypes: string[];
		};
	};
	assert.ok(profile.result.some(({ url }) => url === workletUrl));
	assert.deepEqual(profile['soundscaper-packaged-runtime'].pausedTargetCounts, { worklet: 1 });
	assert.deepEqual(profile['soundscaper-packaged-runtime'].targetCounts, { worklet: 1 });
	assert.deepEqual(profile['soundscaper-packaged-runtime'].targetTypes, ['worklet']);
	assert.ok(page.calls.includes('child:Runtime.evaluate'));
	assert.ok(page.calls.includes('child:Profiler.takePreciseCoverage'));
	assert.ok(page.calls.includes('child:Debugger.resume'));
});

test('packaged shutdown checkpoints before requesting trusted application quit', async () => {
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
	});
	const calls: unknown[][] = [];
	const productPage = fakeClosablePage('product', 'soundscaper-app://bundle/', calls, undefined, () => {
		child.exitCode = 0;
		child.emit('exit', 0, null);
	});
	const diagnosticPage = fakeClosablePage('diagnostic', 'http://127.0.0.1:4567/en/', calls);
	const graceful = await requestPackagedRuntimeShutdown({
		child,
		checkpoint: async () => { calls.push(['checkpoint']); },
		context: { pages: () => [diagnosticPage, productPage] },
		productId: 'soundscaper',
		timeoutMs: 100,
	});

	assert.equal(graceful, true);
	assert.deepEqual(calls, [
		['on', 'product', 'dialog'],
		['on', 'diagnostic', 'dialog'],
		['checkpoint'],
		['quit', 'product'],
		['off', 'product', 'dialog'],
		['off', 'diagnostic', 'dialog'],
	]);
});

test('packaged shutdown closes remaining windows when the trusted bridge is unavailable', async () => {
	const child = Object.assign(new EventEmitter(), {
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
	});
	const calls: unknown[][] = [];
	const productPage = fakeClosablePage('product', 'soundscaper-app://bundle/', calls);
	const diagnosticPage = fakeClosablePage('diagnostic', 'http://127.0.0.1:4567/en/', calls, () => {
		child.exitCode = 0;
		child.emit('exit', 0, null);
	});
	const graceful = await requestPackagedRuntimeShutdown({
		child,
		context: { pages: () => [diagnosticPage, productPage] },
		productId: 'soundscaper',
		timeoutMs: 100,
	});

	assert.equal(graceful, true);
	assert.deepEqual(calls, [
		['on', 'product', 'dialog'],
		['on', 'diagnostic', 'dialog'],
		['quit', 'product'],
		['close', 'product', true],
		['close', 'diagnostic', true],
		['off', 'product', 'dialog'],
		['off', 'diagnostic', 'dialog'],
	]);
});

function fakeClosablePage(
	name: string,
	url: string,
	calls: unknown[][],
	onClose = () => {},
	onQuit: (() => void) | undefined = undefined,
) {
	let closed = false;
	let signalClosed = () => {};
	return {
		url: () => url,
		isClosed: () => closed,
		waitForEvent(event: string) {
			assert.equal(event, 'close');
			return new Promise<void>((resolvePromise) => { signalClosed = resolvePromise; });
		},
		async close(options: { runBeforeUnload?: boolean }) {
			calls.push(['close', name, options.runBeforeUnload]);
			closed = true;
			signalClosed();
			onClose();
		},
		async evaluate() {
			calls.push(['quit', name]);
			if (onQuit === undefined) return false;
			onQuit();
			return true;
		},
		on(event: string) { calls.push(['on', name, event]); },
		off(event: string) { calls.push(['off', name, event]); },
	};
}

function coverageEntry(scriptId: string, url: string, endOffset: number) {
	return {
		functions: [{
			functionName: '',
			isBlockCoverage: true,
			ranges: [{ count: 1, endOffset, startOffset: 0 }],
		}],
		scriptId,
		url,
	};
}

class FakePage {
	readonly calls: string[] = [];
	readonly #childType: string;
	readonly #context: FakeContext | null = null;
	readonly #entries: ReturnType<typeof coverageEntry>[];
	readonly #workerEntries: ReturnType<typeof coverageEntry>[];
	readonly #url: string;
	#coverageTakes = 0;
	reloadCount = 0;

	constructor(
		url: string,
		entries: ReturnType<typeof coverageEntry>[],
		workerEntries: ReturnType<typeof coverageEntry>[] = [],
		childType = 'worker',
	) {
		this.#childType = childType;
		this.#url = url;
		this.#entries = entries;
		this.#workerEntries = workerEntries;
	}

	context(): FakeContext {
		return this.#context ?? (this as unknown as { owner: FakeContext }).owner;
	}

	isClosed(): boolean { return false; }

	async reload(): Promise<void> {
		this.calls.push('Page.reload');
		this.reloadCount += 1;
	}

	async waitForLoadState(): Promise<void> {}
	async waitForFunction(): Promise<void> {}

	url(): string { return this.#url; }

	coverageEntries() { return this.#entries; }
	childType() { return this.#childType; }
	takeCoverageEntries() {
		this.#coverageTakes += 1;
		return this.#coverageTakes === 1 ? [] : this.#entries;
	}

	workerCoverageEntries() { return this.#workerEntries; }
}

class FakeContext {
	readonly #browserRoot = Object.assign(new EventEmitter(), {
		createChildSession() { throw new Error('This fake creates no service workers.'); },
	});
	readonly #listeners: Array<(page: FakePage) => void> = [];
	readonly #pages: FakePage[];

	constructor(pages: FakePage[]) {
		this.#pages = pages;
		for (const page of pages) (page as unknown as { owner: FakeContext }).owner = this;
	}

	browser() {
		const implementation = Object.assign(new EventEmitter(), { _session: this.#browserRoot });
		return {
			_connection: { toImpl: () => implementation },
			async newBrowserCDPSession() {},
		};
	}

	on(event: string, listener: (page: FakePage) => void): void {
		if (event === 'page') this.#listeners.push(listener);
	}

	pages(): FakePage[] { return this.#pages; }

	async newCDPSession(page: FakePage) {
		const emitter = new EventEmitter();
		let childAttached = false;
		return Object.assign(emitter, {
			async detach() { page.calls.push('CDP.detach'); },
			async send(method: string, parameters?: { scriptId?: string }) {
				page.calls.push(method);
				if (method === 'Page.reload') {
					page.reloadCount += 1;
					queueMicrotask(() => emitter.emit('Page.loadEventFired', {}));
				}
				if (method === 'Target.setAutoAttach' && !childAttached && page.workerCoverageEntries().length) {
					childAttached = true;
					queueMicrotask(() => emitter.emit('Target.attachedToTarget', {
						sessionId: 'worker-session',
						targetInfo: {
							targetId: 'worker-target',
							type: page.childType(),
							url: page.workerCoverageEntries()[0]?.url,
						},
						waitingForDebugger: true,
					}));
				}
				if (method === 'Target.sendMessageToTarget') {
					const request = JSON.parse(String((parameters as { message?: string })?.message)) as {
						id: number;
						method: string;
						params?: { scriptId?: string };
					};
					page.calls.push(`child:${request.method}`);
					let result: unknown = {};
					if (request.method === 'Debugger.getScriptSource') {
						result = { scriptSource: `worker-source:${String(request.params?.scriptId)}` };
					} else if (request.method === 'Profiler.takePreciseCoverage') {
						result = {
							result: page.workerCoverageEntries().map((entry) => ({ ...entry, url: '' })),
						};
					} else if (request.method === 'Runtime.evaluate' && page.childType() === 'worklet') {
						result = { result: { value: true } };
					}
					queueMicrotask(() => {
						emitter.emit('Target.receivedMessageFromTarget', {
							message: JSON.stringify({ id: request.id, result }),
							sessionId: 'worker-session',
						});
						if (request.method === 'Debugger.enable') {
							for (const entry of page.workerCoverageEntries()) {
								emitter.emit('Target.receivedMessageFromTarget', {
									message: JSON.stringify({ method: 'Debugger.scriptParsed', params: {
										scriptId: entry.scriptId,
										url: entry.url,
									} }),
									sessionId: 'worker-session',
								});
							}
						}
						if (request.method === 'Runtime.evaluate' && page.childType() === 'worklet') {
							emitter.emit('Target.receivedMessageFromTarget', {
								message: JSON.stringify({ method: 'Debugger.scriptParsed', params: {
									scriptId: 'coverage-worklet-hook',
									url: WORKLET_COVERAGE_CHECKPOINT_URL,
								} }),
								sessionId: 'worker-session',
							});
						}
						if (request.method === 'Runtime.runIfWaitingForDebugger') {
							emitter.emit('Target.receivedMessageFromTarget', {
								message: JSON.stringify({
									method: 'Profiler.preciseCoverageDeltaUpdate',
									params: { result: page.workerCoverageEntries().map((entry) => ({ ...entry, url: '' })) },
								}),
								sessionId: 'worker-session',
							});
							if (page.childType() === 'worklet') {
								emitter.emit('Target.receivedMessageFromTarget', {
									message: JSON.stringify({ method: 'Debugger.paused', params: {
										callFrames: [{ location: { scriptId: 'coverage-worklet-hook' } }],
									} }),
									sessionId: 'worker-session',
								});
							} else {
								emitter.emit('Target.detachedFromTarget', { sessionId: 'worker-session' });
							}
						}
					});
					return {};
				}
				if (method === 'Debugger.enable') {
					for (const entry of page.coverageEntries()) {
						queueMicrotask(() => emitter.emit('Debugger.scriptParsed', {
							scriptId: entry.scriptId,
							url: entry.url,
						}));
					}
				}
				if (method === 'Debugger.getScriptSource') {
					return { scriptSource: `source:${String(parameters?.scriptId)}` };
				}
				if (method === 'Profiler.takePreciseCoverage') {
					return { result: page.takeCoverageEntries() };
				}
				return {};
			},
		});
	}
}
