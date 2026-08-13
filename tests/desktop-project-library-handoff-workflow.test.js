/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDesktopProjectLibraryHandoffStages } from '../scripts/lib/desktop-project-library-handoff-smoke.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop package metadata preserves the historical V9/V17 handoff runners', async () => {
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
	const stages = createDesktopProjectLibraryHandoffStages();
	assert.deepEqual(stages.map(({ productId }) => productId), [
		'soundscaper', 'framescaper', 'soundscaper',
	]);
	assert.ok(stages.every(({ target }) => JSON.parse(target.document).schemaVersion === 17));
});

test('desktop CI does not run historical V9/V17 handoff against current Framescaper', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-handoff/u);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-source-bearing-handoff/u);
	assert.doesNotMatch(workflow, /release\/desktop-handoff\/framescaper/u);
});
