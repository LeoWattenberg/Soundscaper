/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('Stable 1 browser tests exercise the downloaded sites and complete Framescaper map evidence', async () => {
	const workflow = await readWorkflow('soundscaper-stable-1.yml');
	const browser = extractJob(workflow, 'browser');
	assert.match(browser, /run: npm run test:browser:built/u);
	assert.doesNotMatch(browser, /run: npm run test:browser\s*\n/u);
	assert.match(browser, /name: soundscaper-stable-1-framescaper-browser-source-maps/u);
	assert.match(extractJob(workflow, 'source'), /name: soundscaper-stable-1-framescaper-browser-site[\s\S]*?include-hidden-files: true/u);
});

test('Stable 1 stages the checked site and handbook before running fresh Pages preflight', async () => {
	const source = extractJob(await readWorkflow('soundscaper-stable-1.yml'), 'source');
	assert.match(source, /npm run check:static/u);
	assert.doesNotMatch(source, /npm run build:pages/u);
	assert.match(source, /node scripts\/stage-handbook-build\.mjs/u);
	assert.match(source, /node scripts\/check-cloudflare-assets\.mjs/u);
	assert.match(source, /node scripts\/preflight-pages-deploy\.mjs/u);
});

test('nightly target jobs explicitly preserve npm download caching and fresh native installation', async () => {
	const job = extractJob(await readWorkflow('desktop-nightly-tests.yml'), 'package-with-tests');
	assert.match(job, /architecture: \$\{\{ matrix\.target\.node_arch \}\}[\s\S]*?cache: npm/u);
	assert.match(job, /cache-dependency-path: package-lock\.json/u);
	assert.match(job, /run: npm ci/u);
});
