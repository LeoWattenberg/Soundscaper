/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one guard that needs a build, and every job that holds one.
 *
 * `tests/project-transfer-standalone-page-chunks.test.ts` measures the preload
 * set actually emitted into `dist/transfer/<role>/index.html`. That half of the
 * file is the only thing that can see the chunk-graph edges no source closure
 * declares - rolldown injects `vite/preload-helper` into the transfer chunk for
 * its dynamic archive import, and the `$initial` site-entry group owns that
 * helper together with react-dom - so it is the half that catches react-dom
 * arriving on a standalone page. It needs `dist/`, the Node shards never build,
 * and a guard that stands itself down when the build is absent is not a guard:
 * `SOUNDSCAPER_TRANSFER_BUILD_REQUIRED=1` is what turns a missing build into a
 * failure instead of a skip.
 *
 * That variable therefore has to be set wherever a job builds and then claims
 * the build is verified. Two workflows have such a job, both named `quality`,
 * both running `npm run check:static` (which ends in `npm run build`) and both
 * uploading `dist/` as `verified-site-build`. The step was added to one of them.
 * A duplicated job that skipped it would publish an unmeasured build under the
 * same artifact name as a measured one - which is the whole reason this file
 * asserts over *every* such job rather than over the workflow it was written
 * for.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** The test file whose built-output half only runs where a build exists. */
const GUARDED_TEST = 'tests/project-transfer-standalone-page-chunks.test.ts';

/** What turns an absent `dist/` into a failure rather than a skip. */
const BUILD_REQUIRED = 'SOUNDSCAPER_TRANSFER_BUILD_REQUIRED';

/** Every workflow with a job that builds the site and publishes it as verified. */
const BUILDING_WORKFLOWS = [
	'.github/workflows/quality.yml',
	'.github/workflows/desktop-preview.yml',
];

test('every job that publishes a verified build measures the built transfer documents', async () => {
	for (const workflow of BUILDING_WORKFLOWS) {
		const source = await readFile(workflow, 'utf8');
		assert.match(
			source,
			/name: verified-site-build/u,
			`${workflow} is listed here because it publishes a build; if it no longer does, remove it`,
		);
		assert.ok(
			source.includes(GUARDED_TEST),
			`${workflow} builds dist/ and uploads it as verified, so it is a job that can measure the`
			+ ` built transfer documents - and the only one that can. It must run ${GUARDED_TEST}.`,
		);
		assert.match(
			source,
			new RegExp(`${BUILD_REQUIRED}: '1'`, 'u'),
			`${workflow} must set ${BUILD_REQUIRED} so an absent dist/ fails there instead of standing`
			+ ' the guard down',
		);
	}
});

test('the guarded test still reads the variable the workflows set', async () => {
	// A guard nobody sets is as dead as a guard nobody runs, and the two halves
	// are in different files: the assertion above proves the workflows set it,
	// and this one proves the test still keys off that exact name.
	const source = await readFile(GUARDED_TEST, 'utf8');
	assert.ok(
		source.includes(`process.env.${BUILD_REQUIRED} === '1'`),
		`${GUARDED_TEST} must read ${BUILD_REQUIRED} to know a build was promised`,
	);
});
