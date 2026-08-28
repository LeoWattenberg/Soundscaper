/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RETIRED_HANDOFF_PATHS = Object.freeze([
	'desktop/project-library-renderer-smoke.js',
	'desktop/project-library-smoke-project.js',
	'desktop/project-library-source-bearing-renderer-smoke.js',
	'desktop/project-library-source-bearing-smoke.js',
	'desktop/project-library-source-bearing-smoke-session.js',
	'desktop/project-library-fallback-role-witnesses.js',
	'desktop/project-library-smoke-evidence.js',
	'desktop/desktop-smoke-plan.js',
	'scripts/desktop-project-library-handoff-smoke.mjs',
	'scripts/desktop-project-library-source-bearing-handoff-smoke.mjs',
	'scripts/lib/desktop-project-library-handoff-smoke.mjs',
	'scripts/lib/desktop-project-library-source-bearing-handoff.mjs',
]);

test('desktop package metadata omits the retired cross-family handoff runners', async () => {
	const [metadata, ignore] = await Promise.all([
		readFile(resolve(ROOT, 'package.json'), 'utf8').then(JSON.parse),
		readFile(resolve(ROOT, '.gitignore'), 'utf8'),
	]);
	assert.equal(metadata.scripts['desktop:smoke:project-library-handoff'], undefined);
	assert.equal(metadata.scripts['desktop:smoke:project-library-source-bearing-handoff'], undefined);
	assert.match(ignore, /^release\/desktop-handoff\/$/mu);
	for (const path of RETIRED_HANDOFF_PATHS) {
		await assert.rejects(access(resolve(ROOT, path)), { code: 'ENOENT' });
	}
});

test('desktop smoke admission rejects the retired cross-family handoff modes', async () => {
	for (const mode of ['project-library-handoff-v1', 'project-library-source-bearing-handoff-v1']) {
		assert.throws(() => parseDesktopSmokeConfiguration([
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${mode}`,
			'--soundscaper-smoke-plan=e30',
		]), /unsupported desktop smoke mode/iu);
	}

	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-handoff/u);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-source-bearing-handoff/u);
	assert.doesNotMatch(workflow, /release\/desktop-handoff\/framescaper/u);
});
