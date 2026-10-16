/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const workflow of ['quality.yml', 'desktop-preview.yml', 'soundscaper-stable-1.yml']) {
	test(`${workflow} restores reference downloads and authenticated Boost headers before provisioning`, async () => {
		const source = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
		const jobs = source.split(/\n {2}[a-z][a-z0-9-]*:\n/u).slice(1);
		let referenceJobs = 0;
		let boostJobs = 0;
		for (const job of jobs) {
			const provision = job.indexOf('run: npm run provision:interchange-conformance');
			if (provision >= 0) {
				referenceJobs += 1;
				const identity = job.indexOf('node scripts/provision-interchange-conformance.mjs --cache-key');
				const cache = job.indexOf('path: .wrangler/test-download-cache/interchange');
				assert.ok(identity >= 0 && cache > identity && provision > cache,
					'the actual Python ABI/tag identity must select the download cache before provisioning');
				assert.match(job, /steps\.interchange-cache-key\.outputs\.key/u);
				assert.match(job, /scripts\/lib\/interchange-download-cache\.mjs/u);
			}
			const boost = job.indexOf('run: node scripts/ci-provision-framescaper-boost.mjs');
			if (boost >= 0) {
				boostJobs += 1;
				const cache = job.indexOf('path: .wrangler/test-download-cache/boost');
				assert.ok(cache >= 0 && boost > cache);
				assert.match(job.slice(0, cache).split(/\n {6}- /u).at(-1), /if: matrix\.shard == 'framescaper'/u);
				assert.match(job, /config\/boost-multiprecision-source-manifest\.json/u);
				assert.match(job, /scripts\/lib\/framescaper-boost-ci-cache\.mjs/u);
			}
		}
		assert.equal(referenceJobs, workflow === 'desktop-preview.yml' ? 1 : 3);
		assert.equal(boostJobs, 1);
		assert.equal((source.match(/id: interchange-cache-key/gu) ?? []).length, referenceJobs);
		assert.equal((source.match(/name: Restore authenticated Boost test headers/gu) ?? []).length, boostJobs);
	});
}
