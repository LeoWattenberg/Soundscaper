/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { recordBrowserProductSiteEvidence } from '../scripts/lib/browser-product-test-sites.mjs';
import { browserCoverageProfile, createBrowserCoverageCollector } from '../scripts/lib/browser-coverage-profile.mjs';
import { compactV8Coverage } from '../scripts/lib/v8-coverage-compaction.mjs';
import { createBrowserWebAssemblyAuthenticator } from '../scripts/lib/browser-webassembly-coverage.mjs';
import { createMotionscaperOfflineSite } from './browser/helpers/motionscaper-offline-site.ts';

test('offline Motion rehosting preserves exact closure and maps while authenticating its own temporary origin', async () => {
	const workspace = await mkdtemp(resolve('.wrangler/motion-offline-source-'));
	const directory = join(workspace, 'motionscaper'); await mkdir(directory);
	const source = { productId: 'motionscaper' as const, origin: 'http://127.0.0.1:4554', peerOrigin: 'http://127.0.0.1:4553', outputDirectory: relative(resolve('.'), directory).replaceAll('\\', '/') };
	const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const script = 'export const measured = 42;\n';
	const measuredPath = join(workspace, 'src/measured.ts');
	const map = { version: 3, names: [], mappings: 'AAAA', sources: [pathToFileURL(measuredPath).href], x_soundscaper_source_sha256: [createHash('sha256').update(script).digest('hex')] };
	try {
		await mkdir(join(workspace, 'src')); await writeFile(measuredPath, script);
		await mkdir(join(directory, 'en')); await mkdir(`${directory}-source-maps`);
		for (const [path, bytes] of Object.entries({ 'en/index.html': '<html data-product="motionscaper"></html>', '_headers': '', '_redirects': '', 'offline-shell.json': '{}', 'service-worker.js': '/* worker */', 'manifest-motionscaper.webmanifest': '{}', 'canvaskit.wasm': wasm })) await writeFile(join(directory, path), bytes);
		await writeFile(join(directory, 'app.js'), script);
		await writeFile(`${directory}-source-maps/app.js.map`, JSON.stringify(map)); await recordBrowserProductSiteEvidence(source);
		const original = await readFile(join(directory, '.browser-product-build.json'));
		const site = await createMotionscaperOfflineSite(source);
		try {
			assert.notEqual(site.baseURL, source.origin);
			assert.deepEqual(await readFile(join(site.descriptor.outputDirectory, 'canvaskit.wasm')), wasm);
			assert.equal(site.descriptor.outputDirectory.split('/').length, source.outputDirectory.split('/').length);
			assert.equal(await readFile(`${site.descriptor.outputDirectory}-source-maps/app.js.map`, 'utf8'), JSON.stringify(map));
			const authenticate = createBrowserWebAssemblyAuthenticator({ repositoryRoot: resolve('.'), sites: [site.descriptor], ffmpegCoverage: { wasm: { url: 'https://example.invalid/ffmpeg.wasm', byteLength: 8, sha256: createHash('sha256').update(wasm).digest('hex') } } });
			assert.equal(await authenticate({ bytes: wasm, url: `${site.baseURL}/canvaskit.wasm` }), true);
			await assert.rejects(authenticate({ bytes: wasm, url: `${source.origin}/canvaskit.wasm` }), /unapproved/u);
			await assert.rejects(authenticate({ bytes: Buffer.concat([wasm, Buffer.from([1])]), url: `${site.baseURL}/canvaskit.wasm` }), /byte identity/u);
			await site.close(); await assert.rejects(fetch(`${site.baseURL}/en/`));
			assert.deepEqual(await readFile(join(directory, '.browser-product-build.json')), original);
			assert.deepEqual(await readFile(join(site.descriptor.outputDirectory, 'canvaskit.wasm')), wasm, 'coverage bytes remain until fixture teardown');
			const profile = browserCoverageProfile([{
				url: `${site.baseURL}/app.js`, source: script,
				functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: script.length, count: 1 }] }],
			}], () => ({ path: resolve(site.descriptor.outputDirectory, 'app.js'), sourceMap: map }));
			await mkdir(join(workspace, 'raw')); await writeFile(join(workspace, 'raw/profile.json'), JSON.stringify(profile));
		} finally { await site.dispose(); }
		await assert.rejects(readFile(join(site.descriptor.outputDirectory, 'canvaskit.wasm')), /ENOENT/u);
		// Compaction keeps generated line lengths and the exact map. c8 can resolve
		// the original source without reading the now-deleted generated JS or maps.
		const compacted = compactV8Coverage(join(workspace, 'raw'), resolve('.'));
		assert.equal(compacted.result.length, 1);
		await mkdir(join(workspace, 'compacted')); await writeFile(join(workspace, 'compacted/profile.json'), JSON.stringify(compacted));
		execFileSync(process.execPath, [resolve('node_modules/c8/bin/c8.js'), 'report', `--temp-directory=${join(workspace, 'compacted')}`, `--report-dir=${join(workspace, 'report')}`, '--reporter=json-summary', '--include=src/**/*.ts', '--exclude-after-remap'], { cwd: workspace });
		const summary = JSON.parse(await readFile(join(workspace, 'report/coverage-summary.json'), 'utf8')) as Record<string, { lines: { total: number; covered: number } }>;
		assert.equal(summary[measuredPath]?.lines.total, 1); assert.equal(summary[measuredPath]?.lines.covered, 1);
		await writeFile(join(directory, 'canvaskit.wasm'), Buffer.from('changed'));
		await assert.rejects(createMotionscaperOfflineSite(source), /verified motionscaper browser file changed/u);
	} finally { await rm(workspace, { recursive: true, force: true }); }
});

test('portable offline Motion site requires independent launcher stage identity and retains exact source-map custody without Git', async () => {
	const { tmpdir } = await import('node:os');
	const { recordBrowserProductBuildEvidence } = await import('../scripts/lib/browser-product-site-evidence.mjs');
	const root = await mkdtemp(join(tmpdir(), 'motion-offline-portable-'));
	const directory = join(root, 'sites/motionscaper'), runRoot = join(root, 'results');
	const sourceRevision = 'b'.repeat(40), origin = 'http://127.0.0.1:4556';
	const descriptor = { productId: 'motionscaper' as const, origin, outputDirectory: directory };
	const environment = { SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: root, SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
		SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: JSON.stringify({ motionscaper: origin }), SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([descriptor]) };
	try {
		await mkdir(join(directory, 'en'), { recursive: true }); await mkdir(runRoot); await mkdir(`${directory}-source-maps`);
		for (const [path, bytes] of Object.entries({ 'en/index.html': '<html data-product="motionscaper"></html>', '_headers': '', '_redirects': '', 'offline-shell.json': '{}', 'service-worker.js': '/* worker */', 'manifest-motionscaper.webmanifest': '{}', 'app.js': 'export const ok=1;' })) await writeFile(join(directory, path), bytes);
		const productionPath = 'src/motionscaper/editor-project.ts';
		const productionSource = await readFile(resolve(productionPath), 'utf8');
		await mkdir(join(root, 'src/motionscaper'), { recursive: true });
		await writeFile(join(root, productionPath), productionSource);
		await mkdir(join(root, 'config'));
		for (const name of ['ffmpeg-runtime-manifest.json', 'ffmpeg-runtime-publication-policy.json']) {
			await writeFile(join(root, 'config', name), await readFile(resolve('config', name)));
		}
		const map = JSON.stringify({ version: 3, sources: [`file:///old-build/${productionPath}`], names: [], mappings: 'AAAA',
			x_soundscaper_source_sha256: [createHash('sha256').update(productionSource).digest('hex')] });
		await writeFile(`${directory}-source-maps/app.js.map`, map);
		await recordBrowserProductBuildEvidence({ ...descriptor, sourceRevision });
		const open = () => createMotionscaperOfflineSite(undefined, { repositoryRoot: root, environment });
		await assert.rejects(open(), /ENOENT/u, 'site self-declared revision cannot replace missing launcher stage authority');
		await writeFile(join(root, 'stage-manifest.json'), JSON.stringify({ kind: 'soundscaper-desktop-nightly-tests', sourceRevision: 'a'.repeat(40) }));
		await assert.rejects(open(), /wrong build/u);
		await writeFile(join(root, 'stage-manifest.json'), JSON.stringify({ kind: 'soundscaper-desktop-nightly-tests', sourceRevision }));
		const original = await readFile(join(directory, '.browser-product-build.json'));
		const site = await open();
		try {
			assert.ok(site.descriptor.outputDirectory.startsWith(runRoot));
			assert.equal(await readFile(`${site.descriptor.outputDirectory}-source-maps/app.js.map`, 'utf8'), map);
			assert.equal((await fetch(`${site.baseURL}/app.js`)).status, 200);
			await site.close(); await assert.rejects(fetch(`${site.baseURL}/app.js`));
			assert.deepEqual(await readFile(join(directory, '.browser-product-build.json')), original);
			const collector = createBrowserCoverageCollector({ browserName: 'chromium', repositoryRoot: root,
				environment: { ...environment, SCAPE_BROWSER_COVERAGE: '1', SCAPE_BROWSER_COVERAGE_SITES: JSON.stringify([site.descriptor]) } });
			assert.ok(collector); collector.attach(portableContext(`${site.baseURL}/app.js`, 'export const ok=1;'));
			await collector.collect('portable Motion offline', new Set<string>());
		} finally { await site.dispose(); }
		const compacted = compactV8Coverage(join(root, 'coverage/v8-browser'), root);
		const portableUrl = 'file:///__soundscaper_e2e__/browser/motionscaper/app.js';
		assert.deepEqual(compacted.result.map((entry: { url: string }) => entry.url), [portableUrl]);
		const cached = compacted['source-map-cache'][portableUrl].data as { sources: string[]; sourcesContent: string[] };
		assert.deepEqual(cached.sources, [`file:///__soundscaper_repo__/${productionPath}`]);
		assert.deepEqual(cached.sourcesContent, [productionSource]);
		await mkdir(join(root, 'compacted')); await writeFile(join(root, 'compacted/profile.json'), JSON.stringify(compacted));
		execFileSync(process.execPath, [resolve('node_modules/c8/bin/c8.js'), 'report', `--temp-directory=${join(root, 'compacted')}`, `--report-dir=${join(root, 'report')}`, '--reporter=json-summary', '--include=**/src/motionscaper/editor-project.ts', '--allow-external', '--exclude-after-remap'], { cwd: root });
		const summary = JSON.parse(await readFile(join(root, 'report/coverage-summary.json'), 'utf8')) as Record<string, { lines: { covered: number } }>;
		assert.ok(summary[`/__soundscaper_repo__/${productionPath}`]!.lines.covered > 0, 'portable cached map still measures actual Motion production source after clone cleanup');
		await writeFile(`${directory}-source-maps/app.js.map`, '{}');
		await assert.rejects(open(), /source map changed/u);
		await assert.rejects(createMotionscaperOfflineSite(undefined, { repositoryRoot: root, environment: { ...environment, SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS: '{"motionscaper":"http://127.0.0.1:4999"}' } }), /authority/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

function portableContext(url: string, source: string) {
	const page = { isClosed: () => false, context: () => ({ newCDPSession: async () => {
		const session = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown>; detach(): Promise<void> };
		session.send = async method => method === 'Profiler.takePreciseCoverage' ? { result: [{ scriptId: '1', url,
			functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }] }] } : {};
		session.detach = async () => undefined; return session;
	} }) };
	const browserRoot = Object.assign(new EventEmitter(), { createChildSession: () => new EventEmitter() });
	const implementation = Object.assign(new EventEmitter(), { _session: browserRoot });
	return { browser: () => ({ _connection: { toImpl: () => implementation }, newBrowserCDPSession: async () => undefined }),
		pages: () => [page], on: () => undefined };
}
