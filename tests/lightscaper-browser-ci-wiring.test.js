/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractJob } from './helpers/workflow-jobs.js';

test('ordinary browser CI authenticates and transfers Lightscaper builds and sibling maps', async () => {
	for (const [workflowName, buildJob] of [['quality.yml', 'build'], ['desktop-preview.yml', 'quality']]) {
		const source = await workflow(workflowName);
		const publisher = extractJob(source, buildJob);
		const buildIndex = publisher.indexOf('npm run build:browser:lightscaper');
		assert.ok(buildIndex >= 0, `${workflowName} must build Lightscaper`);
		assert.ok(publisher.indexOf('name: verified-lightscaper-site-build') > buildIndex);
		assert.match(publisher,
			/name: verified-lightscaper-site-build\n\s+path: \.wrangler\/browser-products\/lightscaper\/\n\s+include-hidden-files: true/u);
		assert.match(publisher,
			/name: verified-lightscaper-site-source-maps\n\s+path: \.wrangler\/browser-products\/lightscaper-source-maps\//u);
		for (const jobName of ['browser', 'firefox']) {
			const job = extractJob(source, jobName);
			assert.match(job,
				/name: verified-lightscaper-site-build\n\s+path: \.wrangler\/browser-products\/lightscaper/u);
			assert.match(job,
				/name: verified-lightscaper-site-source-maps\n\s+path: \.wrangler\/browser-products\/lightscaper-source-maps/u);
			assert.ok(job.indexOf('name: verified-lightscaper-site-source-maps') < job.indexOf('npm run test:browser:built'));
		}
	}
});

test('other ordinary browser build callers include Lightscaper before site preparation', async () => {
	for (const workflowName of ['desktop-nightly-tests.yml', 'diagnostic-metrics.yml']) {
		const source = await workflow(workflowName);
		assert.ok(source.includes('npm run build:browser:lightscaper'), `${workflowName} must stage the photo browser product`);
		if (source.includes('npm run prepare:browser:products')) {
			assert.ok(source.indexOf('npm run build:browser:lightscaper') < source.indexOf('npm run prepare:browser:products'));
		}
	}
	const stable = await workflow('soundscaper-stable-1.yml');
	assert.match(stable, /npm run build:browser:lightscaper/u);
	assert.equal([...stable.matchAll(/name: soundscaper-stable-1-lightscaper-browser-site/gu)].length, 2);
	assert.match(stable, /name: soundscaper-stable-1-lightscaper-browser-site\n\s+path: \.wrangler\/browser-products\/lightscaper\/\n\s+include-hidden-files: true/u);
});

async function workflow(name) {
	return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}
