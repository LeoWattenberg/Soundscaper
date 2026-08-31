/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';

test('partial packaged-runtime metadata does not abort diagnostics', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-late-error-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let childCalls = 0;
	let siteStarts = 0;
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '1.0.0-rc.1' },
		platform: 'linux',
		arch: 'x64',
		environment: { SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '555.42.02' },
	}, {
		startStaticServer: async () => ({
			baseURL: `http://127.0.0.1:${String(49996 + siteStarts++)}`,
			close: async () => undefined,
		}),
		runPlaywright: async () => {
			childCalls += 1;
			return { code: 0, signal: null };
		},
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
	});

	assert.equal(childCalls, 3);
	assert.equal(completed.exitCode, 0);
	assert.equal(completed.result.status, 'passed');
	assert.equal(completed.result.failure, null);
});
