/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { test } from './helpers/browser-coverage-fixture.js';
import { build } from 'esbuild';
import { verifyMotionSustainedBrowserVideo } from '../../scripts/performance/motionscaper-sustained-browser.ts';

import { authoredWildcardResponseHeaders } from '../../scripts/lib/static-response-headers.mjs';

const origin = 'http://127.0.0.1:4454';
async function oracleBundle() {
	const result = await build({ entryPoints: [resolve('scripts/performance/motionscaper-sustained-webm.ts')],
		bundle: true, write: false, format: 'iife', globalName: 'MotionSustainedVerification', platform: 'browser' });
	assert.equal(result.outputFiles.length, 1);
	const content = result.outputFiles[0]!.text;
	assert.match(content, /^"use strict";\s+var MotionSustainedVerification =/u);
	return content;
}
async function originContext(context: BrowserContext) {
	await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', headers: authoredWildcardResponseHeaders(), body: '<!doctype html><title>Motion oracle scope</title>' }));
	const page = await context.newPage(); await page.goto(`${origin}/en/`); return page;
}

test('Motion sustained actual strict oracle requires document script scope to publish its export', async ({ context }) => {
	const bundle = await oracleBundle(), page = await originContext(context);
	await page.evaluate(bundle);
	assert.equal(await page.evaluate(() => Reflect.has(globalThis, 'MotionSustainedVerification')), false);
	await page.addScriptTag({ content: bundle });
	assert.equal(await page.evaluate(() => {
		const value: unknown = Reflect.get(globalThis, 'MotionSustainedVerification');
		return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'verifyMotionSustainedWebm') === 'function';
	}), true);
});

test('Motion sustained separate reference page reaches the real oracle refusal and closes on failure', async ({ context, browserName }) => {
	test.skip(browserName !== 'chromium', 'The sustained Chromium duration profile requires an actual OPFS destination; other engines retain the script-scope control.');
	const bundle = await oracleBundle(), directory = await mkdtemp(join(tmpdir(), 'motion-oracle-scope-'));
	try {
		const page = await originContext(context);
		await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory(), owned = await root.getDirectoryHandle('motion-oracle-test', { create: true });
			const file = await owned.getFileHandle('empty.webm', { create: true }), writer = await file.createWritable(); await writer.close();
		});
		const outputPath = join(directory, 'reference.json');
		await assert.rejects(verifyMotionSustainedBrowserVideo({ context }, { url: `${origin}/en/`, bundle,
			directoryName: 'motion-oracle-test', fileName: 'empty.webm', frames: 300, references: [], outputPath,
			transfer: { byteLength: 0, sha256: '0'.repeat(64) } }), /WebM reference admission differs\./u);
		assert.deepEqual(context.pages(), [page], 'The failed separate oracle page must close.');
		await assert.rejects(stat(outputPath), { code: 'ENOENT' });
		await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('motion-oracle-test', { recursive: true }); });
	} finally { await rm(directory, { recursive: true, force: true }); }
});
