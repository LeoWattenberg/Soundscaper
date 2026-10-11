/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { recordBrowserProductSiteEvidence } from '../scripts/lib/browser-product-test-sites.mjs';
import { browserCoverageProfile } from '../scripts/lib/browser-coverage-profile.mjs';
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
