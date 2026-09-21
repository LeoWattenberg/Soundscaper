/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';
import { absoluteSourceMapSources } from '../scripts/lib/build-source-map-relocation.mjs';
import { repositoryRevision } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { normalizeE2ESourceMap } from '../scripts/lib/e2e-coverage-source-maps.mjs';

const ORIGIN = 'http://127.0.0.1:4322';
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const workspaces: string[] = [];

after(() => {
	for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true });
});

test('queried Vite loader sources stay generated across collection and build evidence', async () => {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-generated-browser-source-'));
	workspaces.push(workspace);
	const built = join(workspace, 'soundscaper');
	const mapDirectory = join(built, 'assets');
	const sourcePath = join(REPOSITORY_ROOT, 'src/common/editor/macro-script/sandbox-prelude.js');
	const realSource = readFileSync(sourcePath, 'utf8');
	const virtualSource = 'export default "/assets/sandbox-prelude-generated.js";\n';
	assert.notEqual(hash(realSource), hash(virtualSource), 'the loader stub must not authenticate the real source');
	const relativeSource = relative(mapDirectory, sourcePath).replaceAll('\\', '/');
	const buildMap = absoluteSourceMapSources({
		version: 3,
		file: 'app.js',
		sources: [`${relativeSource}?url`],
		sourcesContent: [virtualSource],
		names: [],
		mappings: 'AAAA',
	}, mapDirectory, REPOSITORY_ROOT);
	const buildDigests = buildMap.x_soundscaper_source_sha256 as string[];
	assert.deepEqual(buildDigests, [hash(virtualSource)]);
	assert.notEqual(buildDigests[0], hash(realSource));
	const chunk = 'globalThis.loadedPrelude = true;\n';
	mkdirSync(mapDirectory, { recursive: true });
	writeFileSync(join(mapDirectory, 'app.js'), chunk);
	mkdirSync(`${built}-source-maps`, { recursive: true });
	writeFileSync(join(`${built}-source-maps`, 'app.js.map'), JSON.stringify(buildMap));

	const coverageDirectory = join(workspace, 'coverage');
	const collector = createBrowserCoverageCollector({
		browserName: 'chromium',
		coverageDirectory,
		environment: {
			SCAPE_BROWSER_COVERAGE: '1',
			SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([{
				origin: ORIGIN, outputDirectory: built, productId: 'soundscaper',
			}]),
		},
		repositoryRoot: REPOSITORY_ROOT,
	});
	assert.ok(collector);
	collector.attach(fakeContext(fakePage(`${ORIGIN}/assets/app.js`, chunk)));
	const output = await collector.collect('generated Vite source', new Set<string>());
	assert.ok(output);
	const profile = JSON.parse(readFileSync(output, 'utf8')) as {
		'source-map-cache': Record<string, { data: Record<string, unknown> }>,
	};
	const coverageUrl = 'file:///__soundscaper_e2e__/browser/soundscaper/assets/app.js';
	const portableMap = profile['source-map-cache'][coverageUrl].data as {
		sources: string[], sourcesContent: Array<string | null>,
	};
	const expectedSource = 'file:///__soundscaper_generated__/src/common/editor/macro-script/sandbox-prelude.js%3Furl';
	assert.deepEqual(portableMap.sources, [expectedSource]);
	assert.deepEqual(portableMap.sourcesContent, [null]);

	const revision = repositoryRevision(REPOSITORY_ROOT);
	const normalizedBuild = normalizeE2ESourceMap(buildMap, REPOSITORY_ROOT, 'browser build', revision);
	const normalizedPortable = normalizeE2ESourceMap(portableMap, REPOSITORY_ROOT, 'browser profile', revision);
	for (const normalized of [normalizedBuild, normalizedPortable]) {
		assert.deepEqual(normalized.map.sources, [expectedSource]);
		assert.deepEqual(normalized.map.sourcesContent, [null]);
	}
});

function fakePage(url: string, source: string) {
	const page = {
		isClosed: () => false,
		context: () => ({
			newCDPSession: async () => {
				const session = new EventEmitter() as EventEmitter & {
					send: (method: string) => Promise<unknown>, detach: () => Promise<void>,
				};
				session.send = async (method) => method === 'Profiler.takePreciseCoverage'
					? { result: [{
						scriptId: '1',
						url,
						functions: [{ functionName: '', isBlockCoverage: true, ranges: [{
							startOffset: 0, endOffset: source.length, count: 1,
						}] }],
					}] }
					: {};
				session.detach = async () => undefined;
				return session;
			},
		}),
	};
	return page;
}

function fakeContext(page: ReturnType<typeof fakePage>) {
	const child = new EventEmitter();
	const browserRoot = Object.assign(new EventEmitter(), {
		createChildSession: () => child,
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	return {
		browser: () => ({
			_connection: { toImpl: () => browserImplementation },
			newBrowserCDPSession: async () => undefined,
		}),
		pages: () => [page],
		on: () => undefined,
	};
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
