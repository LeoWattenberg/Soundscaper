/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import {
	buildMacroSandboxModule,
} from '../src/common/editor/macro-script/sandbox-client.ts';

import {
	browserCoverageProfile,
	browserCoverageRequested,
	builtChunkFor,
	collectsBrowserCoverage,
	createBrowserCoverageCollector,
	sourceLineLengths,
	sourceMapPathFor,
	withoutRepeatedSourceMaps,
} from '../scripts/lib/browser-coverage-profile.mjs';
import { isUnmappedBrowserSourceMap } from '../scripts/lib/browser-dynamic-coverage-sources.mjs';

const ORIGIN = 'http://127.0.0.1:4322';
const CHUNK = 'console.log(1);\nexport const measured = 2;\n';
const MAP = {
	version: 3,
	sources: ['file:///repository/src/common/measured.ts'],
	sourcesContent: ['export const measured = 2;\n'],
	mappings: 'AAAA',
};
const workspaces: string[] = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('an ordinary browser run is never instrumented', () => {
	assert.equal(browserCoverageRequested({}), false);
	assert.equal(browserCoverageRequested({ SCAPE_BROWSER_COVERAGE: '1' }), true);

	assert.equal(collectsBrowserCoverage('chromium', { SCAPE_BROWSER_COVERAGE: '1' }), true);
	assert.equal(collectsBrowserCoverage('chromium', {}), false, 'the variable has to be asked for');
	assert.equal(collectsBrowserCoverage('chromium', { SCAPE_BROWSER_COVERAGE: '0' }), false);
	for (const browserName of ['firefox', 'webkit']) {
		assert.equal(
			collectsBrowserCoverage(browserName, { SCAPE_BROWSER_COVERAGE: '1' }),
			false,
			`${browserName} has no V8 coverage to record`,
		);
	}
});

test('a run that wants no coverage builds no collector at all', () => {
	assert.equal(createBrowserCoverageCollector({ browserName: 'chromium', environment: {} }), null);
	assert.equal(
		createBrowserCoverageCollector({ browserName: 'webkit', environment: { SCAPE_BROWSER_COVERAGE: '1' } }),
		null,
	);
});

test('line lengths describe the served chunk, whether or not it ends in a newline', () => {
	assert.deepEqual(sourceLineLengths('abc\nde\n'), [3, 2]);
	assert.deepEqual(sourceLineLengths('abc\nde'), [3, 2]);
	assert.deepEqual(sourceLineLengths('abc\n\nde\n'), [3, 0, 2]);
	assert.deepEqual(sourceLineLengths(''), [0]);
});

test('a served script resolves to the built file it was served from', () => {
	const directories = new Map([[ORIGIN, '/build/soundscaper']]);

	assert.deepEqual(builtChunkFor(`${ORIGIN}/assets/app-abc123.js`, directories), {
		path: '/build/soundscaper/assets/app-abc123.js',
		directory: '/build/soundscaper',
	});
	assert.deepEqual(builtChunkFor(`${ORIGIN}/assets/app-abc123.js?v=2`, directories), {
		path: '/build/soundscaper/assets/app-abc123.js',
		directory: '/build/soundscaper',
	});
	assert.equal(builtChunkFor('http://127.0.0.1:9999/assets/app.js', directories), null, 'an unplanned origin');
	assert.equal(builtChunkFor(`${ORIGIN}/en/`, directories), null, 'a document is not a script');
	assert.equal(
		builtChunkFor(`${ORIGIN}/assets/..%2f..%2fetc/passwd.js`, directories),
		null,
		'no escaping the build',
	);
	assert.equal(builtChunkFor('data:text/javascript,void 0', directories), null, 'an inline script');
	assert.equal(builtChunkFor('', directories), null, 'an anonymous script');
});

test('a chunk reads its map from the sibling directory the build wrote it to', () => {
	assert.equal(
		sourceMapPathFor({ path: '/build/soundscaper/assets/app-abc123.js', directory: '/build/soundscaper' }),
		'/build/soundscaper-source-maps/app-abc123.js.map',
	);
});

test('empty and non-executable-only maps leave emitted JavaScript as the coverage source', () => {
	assert.equal(isUnmappedBrowserSourceMap({ sources: [], mappings: '' }), true);
	assert.equal(isUnmappedBrowserSourceMap({ sources: ['src/messages.json'], mappings: 'AAAA' }), true);
	assert.equal(isUnmappedBrowserSourceMap({ sources: ['src/editor.ts'], mappings: 'AAAA' }), false);
	assert.equal(isUnmappedBrowserSourceMap({
		sources: ['src/unused.ts', 'node_modules/vendor/runtime.js'],
		mappings: 'ACAA',
	}), true, 'an unused listed first-party source cannot transfer map ownership');
	assert.equal(isUnmappedBrowserSourceMap({
		sources: ['node_modules/vendor/runtime.js'],
		mappings: 'AAAA',
	}), false, 'a pure mapped vendor artifact retains its explicit external provenance');
	assert.equal(isUnmappedBrowserSourceMap({
		sources: ['node_modules/vendor/runtime.js', 'https://cdn.invalid/theme.css'],
		mappings: 'AAAA;ACAA',
	}), true, 'mapped unknown non-code input prevents vendor-only exclusion');
});

test('coverage entries become a raw V8 profile addressed by the chunk on disk', () => {
	const path = '/build/soundscaper/assets/app-abc123.js';
	const profile = browserCoverageProfile(
		[
			{
				url: `${ORIGIN}/assets/app-abc123.js`,
				scriptId: '7',
				source: CHUNK,
				functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 41, count: 1 }] }],
			},
			{ url: `${ORIGIN}/assets/unmapped.js`, scriptId: '8', source: 'void 0;\n', functions: [] },
		],
		(url) => (url.endsWith('app-abc123.js') ? { path, sourceMap: MAP } : null),
	);

	const url = pathToFileURL(path).href;
	assert.deepEqual((profile.result as { url: string }[]).map((entry) => entry.url), [url]);
	assert.deepEqual(Object.keys(profile['source-map-cache']), [url]);
	assert.deepEqual(profile['source-map-cache'][url], {
		lineLengths: [15, 26],
		data: MAP,
		url: null,
	});
});

test('a chunk with no map contributes nothing rather than a file no scope owns', () => {
	const profile = browserCoverageProfile(
		[{ url: `${ORIGIN}/assets/app.js`, scriptId: '1', source: CHUNK, functions: [] }],
		() => null,
	);

	assert.deepEqual(profile.result, []);
	assert.deepEqual(Object.keys(profile['source-map-cache']), []);
});

test('a map is written once per worker, not once per test', () => {
	const url = pathToFileURL('/build/soundscaper/assets/app.js').href;
	const written = new Set<string>();
	const profile = { result: [{ url }], 'source-map-cache': { [url]: { lineLengths: [1], data: MAP, url: null } } };

	const first = withoutRepeatedSourceMaps(profile, written);
	const second = withoutRepeatedSourceMaps(profile, written);

	assert.deepEqual(Object.keys(first['source-map-cache']), [url]);
	assert.deepEqual(Object.keys(second['source-map-cache']), [], 'the second test carries ranges only');
	assert.deepEqual(second.result, profile.result);
});

test('an authenticated macro module keeps exact dynamic source and a fixed-wrapper map', () => {
	const prelude = `import "${ORIGIN}/assets/sandbox-prelude-abc123.js";`;
	const source = buildMacroSandboxModule(prelude, 'await sound.select.all();');
	const sourceUrl = /\/\/# sourceURL=(\S+)\n$/u.exec(source)?.[1];
	assert.ok(sourceUrl);
	const profile = browserCoverageProfile(
		[{ url: sourceUrl, scriptId: 'macro', source, functions: [] }],
		(url, captured) => ({
			coverageUrl: url,
			path: '/unused/generated-macro.js',
			retainSource: true,
			source: captured,
			sourceMap: MAP,
		}),
	);

	assert.deepEqual(profile.result.map(({ url }) => url), [sourceUrl]);
	assert.equal(profile['script-source-cache'][sourceUrl], source);
	assert.deepEqual(profile['source-map-cache'][sourceUrl], {
		data: MAP,
		lineLengths: sourceLineLengths(source),
		url: null,
	});
	assert.equal(withoutRepeatedSourceMaps(profile, new Set())['script-source-cache'][sourceUrl], source);
});

test('the collector records every page a context opens and writes one profile per test', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'soundscaper');
	mkdirSync(join(built, 'assets'), { recursive: true });
	writeFileSync(join(built, 'assets/app-abc123.js'), CHUNK);
	mkdirSync(join(workspace, 'soundscaper-source-maps'), { recursive: true });
	writeFileSync(join(workspace, 'soundscaper-source-maps/app-abc123.js.map'), JSON.stringify(MAP));
	const coverageDirectory = join(workspace, 'v8-browser');

	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		environment: { SCAPE_BROWSER_COVERAGE: '1' },
		sites: [{ origin: ORIGIN, outputDirectory: built }],
		coverageDirectory,
	});
	assert.ok(collector, 'chromium with the variable set must collect');

	const opened = fakePage(`${ORIGIN}/assets/app-abc123.js`);
	const popup = fakePage(`${ORIGIN}/assets/app-abc123.js`);
	const context = fakeContext([opened]);
	collector.attach(context);
	context.emitPage(popup);
	await collector.settle();
	assert.deepEqual([opened.started, popup.started], [true, true], 'a popup is measured too');
	for (const page of [opened, popup]) {
		assert.equal(
			page.sent.some(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument'),
			true,
			'a page installs its pre-navigation coverage checkpoint',
		);
	}

	const file = await collector.collect('workspace › records a take', new Set<string>());

	assert.equal(readdirSync(coverageDirectory).length, 1);
	assert.match(String(file), /workspace-records-a-take-[0-9a-f-]+\.json$/u);
	const profile = JSON.parse(readFileSync(String(file), 'utf8')) as {
		result: { url: string }[],
		'source-map-cache': Record<string, { lineLengths: number[], data: unknown }>,
	};
	const url = pathToFileURL(join(built, 'assets/app-abc123.js')).href;
	assert.deepEqual(profile.result.map((entry) => entry.url), [url, url], 'both pages ran the chunk');
	assert.deepEqual(Object.keys(profile['source-map-cache']), [url]);
	assert.deepEqual(profile['source-map-cache'][url].data, MAP);
	assert.deepEqual(profile['source-map-cache'][url].lineLengths, sourceLineLengths(CHUNK));
});

test('the collector honors a packaged run site map and durable coverage directory', async () => {
	const workspace = makeWorkspace();
	const payloadRoot = join(workspace, 'payload');
	const built = join(payloadRoot, 'sites/soundscaper');
	const externalSources = [
		'file:///old-checkout/vendor/audacity-design-system/components/src/EffectDialog/EffectHeader.css',
		'file:///old-checkout/node_modules/example/src/index.js',
	];
	mkdirSync(join(built, 'assets'), { recursive: true });
	writeFileSync(join(built, 'assets/app-abc123.js'), CHUNK);
	mkdirSync(join(workspace, 'payload/sites/soundscaper-source-maps'), { recursive: true });
	writeFileSync(
		join(workspace, 'payload/sites/soundscaper-source-maps/app-abc123.js.map'),
		JSON.stringify({ ...MAP, sources: [...MAP.sources, ...externalSources] }),
	);
	mkdirSync(join(payloadRoot, 'src/common'), { recursive: true });
	writeFileSync(join(payloadRoot, 'src/common/measured.ts'), 'export const measured = 2;\n');
	const coverageDirectory = join(workspace, 'run/coverage/v8-browser');
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_DIRECTORY: coverageDirectory,
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				productId: 'soundscaper',
				origin: ORIGIN,
				outputDirectory: built,
			}]),
		},
		repositoryRoot: payloadRoot,
		sites: [{ origin: 'http://127.0.0.1:9999', outputDirectory: '/wrong/build' }],
	});
	assert.ok(collector);
	collector.attach(fakeContext([fakePage(`${ORIGIN}/assets/app-abc123.js`)]));
	await collector.collect('nightly packaged browser', new Set<string>());

	const [name] = readdirSync(coverageDirectory);
	const profile = JSON.parse(readFileSync(join(coverageDirectory, name), 'utf8')) as {
		result: { url: string }[],
		'source-map-cache': Record<
			string,
			{ data: { sources: string[], sourcesContent: (string | null)[] } }
		>,
	};
	const portableUrl = 'file:///__soundscaper_e2e__/browser/soundscaper/assets/app-abc123.js';
	assert.deepEqual(profile.result.map(({ url }) => url), [portableUrl]);
	assert.deepEqual(Object.keys(profile['source-map-cache']), [portableUrl]);
	assert.deepEqual(profile['source-map-cache'][portableUrl].data.sources, [
		'file:///__soundscaper_repo__/src/common/measured.ts',
		...externalSources,
	]);
	assert.deepEqual(profile['source-map-cache'][portableUrl].data.sourcesContent, [
		'export const measured = 2;\n',
		null,
		null,
	]);
});

test('a portable nightly profile retains exact shipped bytes when its source map has no mappings', async () => {
	const workspace = makeWorkspace();
	const payloadRoot = join(workspace, 'payload');
	const built = join(payloadRoot, 'sites/soundscaper');
	mkdirSync(built, { recursive: true });
	writeFileSync(join(built, 'service-worker.js'), CHUNK);
	const mapRoot = join(payloadRoot, 'sites/soundscaper-source-maps');
	mkdirSync(mapRoot, { recursive: true });
	writeFileSync(join(mapRoot, 'service-worker.js.map'), JSON.stringify({
		version: 3,
		file: 'service-worker.js',
		sourceRoot: '',
		sources: [],
		names: [],
		mappings: '',
	}));
	const coverageDirectory = join(workspace, 'run/coverage/v8-browser');
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_DIRECTORY: coverageDirectory,
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				productId: 'soundscaper',
				origin: ORIGIN,
				outputDirectory: built,
			}]),
		},
		repositoryRoot: payloadRoot,
	});
	assert.ok(collector);
	const context = fakeContext([fakePage('')], {
		source: CHUNK,
		url: `${ORIGIN}/service-worker.js`,
	});
	collector.attach(context);
	context.emitServiceWorker();
	await collector.collect('nightly service worker', new Set<string>());

	const [name] = readdirSync(coverageDirectory);
	const profile = JSON.parse(readFileSync(join(coverageDirectory, name), 'utf8')) as {
		result: { url: string }[], 'source-map-cache': Record<string, unknown>,
	};
	assert.deepEqual(profile.result.map(({ url }) => url), [
		'file:///__soundscaper_e2e__/browser/soundscaper/service-worker.js',
	]);
	assert.deepEqual(Object.keys(profile['source-map-cache']), []);
});

test('a portable nightly profile rejects an unknown named dynamic script', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'sites/soundscaper');
	mkdirSync(built, { recursive: true });
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		coverageDirectory: join(workspace, 'run/coverage/v8-browser'),
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				productId: 'soundscaper',
				origin: ORIGIN,
				outputDirectory: built,
			}]),
		},
		repositoryRoot: workspace,
	});
	assert.ok(collector);
	collector.attach(fakeContext([fakePage('soundscaper-unapproved://runtime.js')]));
	await assert.rejects(
		collector.collect('unknown named dynamic', new Set<string>()),
		/unapproved dynamic script soundscaper-unapproved:\/\/runtime\.js/u,
	);
});

test('a portable nightly profile rejects an unknown captured source without a V8 entry', async () => {
	const workspace = makeWorkspace();
	const built = join(workspace, 'sites/soundscaper');
	mkdirSync(built, { recursive: true });
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		coverageDirectory: join(workspace, 'run/coverage/v8-browser'),
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				productId: 'soundscaper',
				origin: ORIGIN,
				outputDirectory: built,
			}]),
		},
		repositoryRoot: workspace,
	});
	assert.ok(collector);
	collector.attach(fakeContext([fakePage('', {
		orphanSource: 'globalThis.unowned = true;',
		orphanUrl: 'blob:http://127.0.0.1/unobserved',
	})]));
	await assert.rejects(
		collector.collect('unknown unobserved dynamic', new Set<string>()),
		/unapproved dynamic script blob:http:\/\/127\.0\.0\.1\/unobserved/u,
	);
});

test('a test that ran nothing the build serves writes no profile', async () => {
	const workspace = makeWorkspace();
	const coverageDirectory = join(workspace, 'v8-browser');
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		environment: { SCAPE_BROWSER_COVERAGE: '1' },
		sites: [{ origin: ORIGIN, outputDirectory: join(workspace, 'soundscaper') }],
		coverageDirectory,
	});
	assert.ok(collector);
	collector.attach(fakeContext([fakePage('https://example.invalid/vendor.js')]));

	assert.equal(await collector.collect('nothing measured', new Set<string>()), null);
	assert.throws(() => readdirSync(coverageDirectory), /ENOENT/u);
});

interface FakePage {
	started: boolean;
	sent: [string, unknown][];
	isClosed: () => boolean;
	context: () => { newCDPSession: (page: FakePage) => Promise<FakeSession> };
}

interface FakeSession {
	send: (method: string, params?: unknown) => Promise<unknown>;
	on: (event: string, listener: (value: unknown) => void) => void;
	detach: () => Promise<void>;
}

function fakePage(url: string, dynamic: { orphanSource: string; orphanUrl: string } | null = null): FakePage {
	const page: FakePage = {
		started: false,
		sent: [],
		isClosed: () => false,
		context: () => ({
			newCDPSession: (target) => {
				assert.equal(target, page, 'the session belongs to the page it records');
				let parsed: ((value: unknown) => void) | null = null;
				const session: FakeSession = {
					send: (method, params) => {
						page.sent.push([method, params]);
						if (method === 'Profiler.startPreciseCoverage') {
							assert.deepEqual(params, { callCount: false, detailed: true }, 'binary block coverage');
							page.started = true;
						}
						if (method === 'Debugger.enable' && dynamic !== null) {
							queueMicrotask(() => parsed?.({
								scriptId: 'orphan',
								url: dynamic.orphanUrl,
							}));
						}
						if (method === 'Debugger.getScriptSource') {
							return Promise.resolve({ scriptSource: dynamic?.orphanSource });
						}
						if (method === 'Profiler.takePreciseCoverage') {
							return Promise.resolve({ result: [{
								url,
								scriptId: '1',
								functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 41, count: 1 }] }],
							}] });
						}
						return Promise.resolve({});
					},
					on: (event, listener) => {
						if (event === 'Debugger.scriptParsed') parsed = listener;
					},
					detach: () => Promise.resolve(),
				};
				return Promise.resolve(session);
			},
		}),
	};
	return page;
}

function fakeContext(pages: FakePage[], serviceWorker?: { source: string, url: string }) {
	const listeners: ((page: FakePage) => void)[] = [];
	const child = Object.assign(new EventEmitter(), {
		async send(method: string, _parameters?: { scriptId?: string }) {
			if (method === 'Debugger.enable' && serviceWorker !== undefined) {
				queueMicrotask(() => child.emit('Debugger.scriptParsed', {
					scriptId: 'service-worker-script',
					url: serviceWorker.url,
				}));
			}
			if (method === 'Debugger.getScriptSource') return { scriptSource: serviceWorker?.source ?? '' };
			if (method === 'Profiler.takePreciseCoverage' && serviceWorker !== undefined) {
				return { result: [{
					url: '',
					scriptId: 'service-worker-script',
					functions: [{
						functionName: '',
						isBlockCoverage: true,
						ranges: [{ startOffset: 0, endOffset: serviceWorker.source.length, count: 1 }],
					}],
				}] };
			}
			return {};
		},
	});
	const browserRoot = Object.assign(new EventEmitter(), {
		createChildSession(_sessionId: string) { return child; },
	});
	browserRoot.on('Target.attachedToTarget', ({ sessionId }) => {
		browserRoot.createChildSession(sessionId);
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	const browser = {
		_connection: { toImpl: () => browserImplementation },
		async newBrowserCDPSession() {},
	};
	return {
		browser: () => browser,
		pages: () => pages,
		on: (event: string, listener: (page: FakePage) => void) => {
			if (event === 'page') listeners.push(listener);
		},
		emitPage: (page: FakePage) => {
			for (const listener of listeners) listener(page);
		},
		emitServiceWorker: () => {
			if (serviceWorker === undefined) throw new Error('This fake has no service worker.');
			browserRoot.emit('Target.attachedToTarget', {
				sessionId: 'service-worker-session',
				targetInfo: { type: 'service_worker', url: serviceWorker.url },
				waitingForDebugger: true,
			});
		},
	};
}

function makeWorkspace(): string {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-browser-coverage-'));
	workspaces.push(workspace);
	return workspace;
}
