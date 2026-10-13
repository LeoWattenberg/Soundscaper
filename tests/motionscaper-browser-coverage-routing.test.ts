/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBrowserWebAssemblyAuthenticator } from '../scripts/lib/browser-webassembly-coverage.mjs';
import test from 'node:test';
import { extractJob } from './helpers/workflow-jobs.js';

test('standard browser preparation builds every required product before validating sites', async () => {
	const value = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
	assert.equal(value.scripts['pretest:browser'], 'npm run build && npm run build:browser:framescaper && npm run build:browser:motionscaper && npm run prepare:browser:products');
	assert.ok(value.scripts['desktop:nightly-tests:dist']!.startsWith(`${value.scripts['pretest:browser']} && npm run pretest:browser:dual-origin`));
});

test('Motion linked browser coverage names its actual built origins and checkout source maps', async () => {
	const module = await import('../playwright.motionscaper-links.config.mjs');
	const config = module.default as { workers: number; use: { browserCoverageSites?: { productId: string; origin: string; outputDirectory: string }[] }; webServer?: unknown };
	const sites = config.use.browserCoverageSites; assert.ok(sites);
	assert.equal(config.webServer, undefined, 'dedicated test fixtures own the two origins through collector teardown');
	assert.equal(config.workers, 1);
	assert.deepEqual(sites.map(site => site.productId), ['framescaper', 'motionscaper']);
	for (const [index, site] of sites.entries()) {
		assert.equal(site.origin, `http://127.0.0.1:${index === 0 ? process.env.PLAYWRIGHT_LINK_FRAME_PORT || 4345 : process.env.PLAYWRIGHT_LINK_MOTION_PORT || 4346}`);
		assert.equal(site.outputDirectory, resolve('.wrangler/motionscaper-links', site.productId));
	}
	const fixture = await readFile(new URL('./browser/helpers/browser-coverage-fixture.js', import.meta.url), 'utf8');
	assert.match(fixture, /sites: browserCoverageSites \?\? browserProductSites\(\)/u);
	for (const file of ['quality.yml', 'desktop-preview.yml']) {
		const workflow = extractJob(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'), 'browser');
		assert.match(workflow, /run: npm run test:browser:motion-links\n\s+env:\n\s+SCAPE_BROWSER_COVERAGE: '1'/u);
	}
});

test('Motion coverage authenticates retained WASM against its own product, revision and exact bytes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-coverage-wasm-'));
	const origin = 'http://127.0.0.1:4346', sourceRevision = 'a'.repeat(40), bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const sha256 = createHash('sha256').update(bytes).digest('hex'), artifact = 'runtime/canvaskit.wasm';
	try {
		await mkdir(join(root, 'runtime')); await writeFile(join(root, artifact), bytes);
		const manifest = { schemaVersion: 2, productId: 'motionscaper', origin, sourceRevision, files: { [artifact]: { byteLength: bytes.length, sha256 } } };
		await writeFile(join(root, '.browser-product-build.json'), JSON.stringify(manifest));
		const create = () => createBrowserWebAssemblyAuthenticator({ repositoryRoot: root, expectedSourceRevision: sourceRevision,
			ffmpegCoverage: { wasm: { byteLength: bytes.length, sha256, url: 'https://assets.example.invalid/ffmpeg.wasm' } },
			sites: [{ productId: 'motionscaper', origin, outputDirectory: root }] });
		assert.equal(await create()({ bytes, url: `${origin}/${artifact}` }), true);
		await assert.rejects(create()({ bytes: Buffer.from([...bytes, 0]), url: `${origin}/${artifact}` }), /byte identity/u);
		await assert.rejects(create()({ bytes, url: `http://127.0.0.1:4345/${artifact}` }), /unapproved/u);
		for (const change of [{ productId: 'framescaper' }, { sourceRevision: 'b'.repeat(40) }]) {
			await writeFile(join(root, '.browser-product-build.json'), JSON.stringify({ ...manifest, ...change }));
			await assert.rejects(create()({ bytes, url: `${origin}/${artifact}` }), /authenticate/u);
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
