/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop package metadata exposes the bounded project-library handoff smoke', async () => {
	const [metadata, ignore] = await Promise.all([
		readFile(resolve(ROOT, 'package.json'), 'utf8').then(JSON.parse),
		readFile(resolve(ROOT, '.gitignore'), 'utf8'),
	]);
	assert.equal(
		metadata.scripts['desktop:smoke:project-library-handoff'],
		'node scripts/desktop-project-library-handoff-smoke.mjs',
	);
	assert.equal(
		metadata.scripts['desktop:smoke:project-library-source-bearing-handoff'],
		'node scripts/desktop-project-library-source-bearing-handoff-smoke.mjs',
	);
	assert.match(ignore, /^release\/desktop-handoff\/$/mu);
});

test('desktop CI builds and runs both unpacked products in one Linux x64 handoff job', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	const jobStart = workflow.indexOf('\n  project-library-handoff:');
	assert.ok(jobStart >= 0, 'missing packaged project-library handoff job');
	const job = workflow.slice(jobStart);

	assert.match(job, /needs: \[quality, browser, firefox\]/u);
	assert.match(job, /runs-on: ubuntu-24\.04/u);
	assert.match(job, /timeout-minutes: 45/u);
	assert.match(job, /name: Stage Soundscaper\s+run: node scripts\/desktop-prepare\.mjs\s+env:\s+SCAPE_PRODUCT: soundscaper/u);
	assert.match(job, /name: Stage Framescaper\s+run: node scripts\/desktop-prepare\.mjs\s+env:\s+SCAPE_PRODUCT: framescaper/u);
	assert.match(job, /--config\.directories\.output=release\/desktop-handoff\/soundscaper[\s\S]*--linux --x64 --dir/u);
	assert.match(job, /--config\.directories\.output=release\/desktop-handoff\/framescaper[\s\S]*--linux --x64 --dir/u);
	assert.match(job, /release\/desktop-handoff\/soundscaper\/linux-unpacked\/chrome-sandbox/u);
	assert.match(job, /release\/desktop-handoff\/framescaper\/linux-unpacked\/chrome-sandbox/u);
	assert.match(job, /npm run desktop:smoke:project-library-handoff/u);
	assert.match(job, /name: Run packaged source-bearing cross-product roundtrips\s+run: npm run desktop:smoke:project-library-source-bearing-handoff/u);
	assert.match(job, /SOUNDSCAPER_SMOKE_XVFB: 'true'/u);
	assert.ok(
		job.indexOf('npm run desktop:smoke:project-library-source-bearing-handoff')
			> job.indexOf('npm run desktop:smoke:project-library-handoff'),
		'source-bearing roundtrips must run after the source-free lifecycle',
	);
});
