/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('static web routes receive product-specific install manifests and Apple touch icons', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-install-routes-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en" dir="ltr" data-product="soundscaper">
	<head><!-- route-head --><title>Soundscaper</title></head>
	<body><div id="app"></div></body>
</html>`);
	await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
	});

	const root = await readFile(join(outputRoot, 'index.html'), 'utf8');
	const soundscaper = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	const framescaper = await readFile(join(outputRoot, 'framescaper/en/index.html'), 'utf8');
	assertInstallLinks(root, 'soundscaper');
	assertInstallLinks(soundscaper, 'soundscaper');
	assertInstallLinks(framescaper, 'framescaper');
	assert.doesNotMatch(framescaper, /manifest-soundscaper|soundscaper-180/u);
});

test('stable install metadata and icon URLs require revalidation', async () => {
	const headers = await readFile('public/_headers', 'utf8');
	assert.match(headers, /\/offline-icons\/\*\n\tCache-Control: no-cache/u);
	assert.match(headers, /\/manifest-\*\.webmanifest\n\tCache-Control: no-cache/u);
});

function assertInstallLinks(html, productId) {
	assert.match(html, new RegExp(`<link rel="manifest" href="/manifest-${productId}\\.webmanifest" data-product-manifest \\/>`, 'u'));
	assert.match(html, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="/offline-icons/${productId}-180\\.png" data-product-install-icon \\/>`, 'u'));
}
