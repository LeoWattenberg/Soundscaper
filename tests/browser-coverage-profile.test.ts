/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

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
	isClosed: () => boolean;
	coverage: {
		startJSCoverage: (options: { resetOnNavigation: boolean }) => Promise<void>;
		stopJSCoverage: () => Promise<{ url: string, scriptId: string, source: string, functions: unknown[] }[]>;
	};
}

function fakePage(url: string): FakePage {
	const page: FakePage = {
		started: false,
		isClosed: () => false,
		coverage: {
			startJSCoverage: (options) => {
				assert.deepEqual(options, { resetOnNavigation: false }, 'coverage must survive a navigation');
				page.started = true;
				return Promise.resolve();
			},
			stopJSCoverage: () => Promise.resolve([{
				url,
				scriptId: '1',
				source: CHUNK,
				functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 41, count: 1 }] }],
			}]),
		},
	};
	return page;
}

function fakeContext(pages: FakePage[]) {
	const listeners: ((page: FakePage) => void)[] = [];
	return {
		pages: () => pages,
		on: (event: string, listener: (page: FakePage) => void) => {
			if (event === 'page') listeners.push(listener);
		},
		emitPage: (page: FakePage) => {
			for (const listener of listeners) listener(page);
		},
	};
}

function makeWorkspace(): string {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-browser-coverage-'));
	workspaces.push(workspace);
	return workspace;
}
