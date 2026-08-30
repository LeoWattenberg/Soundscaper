/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	DESKTOP_EXPECTED_RUNTIME_FILES,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import {
	DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES,
} from '../scripts/lib/desktop-project-library-baseline-runtime-files.mjs';
import { DESKTOP_SOUNDSCAPER_RUNTIME_FILES } from '../scripts/lib/desktop-soundscaper-runtime-files.mjs';

const RETIRED_LIBRARY = /(?:^|\/)(?:soundscaper-)?project-library-v(?:10|1[2-9]|20)(?:-|\.)/u;

test('desktop staging contains only unversioned v1 project-library authorities', () => {
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.some((file) => RETIRED_LIBRARY.test(file)), false);
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.filter((file) => (
		file.startsWith('desktop/framescaper-project-library-')
	)), [
		'desktop/framescaper-project-library-contract.js',
		'desktop/framescaper-project-library-current-project.js',
		'desktop/framescaper-project-library-database.js',
		'desktop/framescaper-project-library-main-channels.js',
		'desktop/framescaper-project-library-main-ipc.js',
		'desktop/framescaper-project-library-main.js',
		'desktop/framescaper-project-library-values.js',
		'desktop/framescaper-project-library-writer.js',
	]);
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/soundscaper-project-library-main.js'));
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/soundscaper-delivery-worker-port.js'));
});

test('Soundscaper packaging carries the restart smoke and its exact compiled recovery closure', async () => {
	const requiredRuntime = [
		'desktop/soundscaper-delivery-database.js',
		'desktop/soundscaper-delivery-service.js',
		'src/common/editor/soundscaper-delivery-contract-v1.js',
		'src/common/editor/soundscaper-persistent-delivery-plan-v1.js',
	];
	assert.deepEqual(
		requiredRuntime.filter((file) => !DESKTOP_SOUNDSCAPER_RUNTIME_FILES.includes(file)),
		[],
	);
	const dispatcher = await readFile('desktop/soundscaper-professional-native-utility-smoke.mjs', 'utf8');
	const smoke = await readFile('desktop/soundscaper-delivery-restart-smoke.mjs', 'utf8');
	assert.match(dispatcher, /from '.\/soundscaper-delivery-restart-smoke\.mjs'/u);
	for (const file of requiredRuntime) {
		assert.match(smoke, new RegExp(`project-library-runtime/${file.replaceAll('.', '\\.')}`));
	}
});
