/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';

test('a late packaged-metrics admission error cannot retain an earlier passing outcome', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-late-error-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let childCalls = 0;
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '0.2.0-beta.1' },
		platform: 'linux',
		arch: 'x64',
		environment: {},
	}, {
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:49996',
			close: async () => undefined,
		}),
		runPlaywright: async () => {
			childCalls += 1;
			return { code: 0, signal: null };
		},
		writeMetricsEvidence: async () => ({ passed: true }),
		writePackagedMetricsEvidence: async () => {
			throw new Error('Packaged evidence must not run without environment identity.');
		},
	});

	assert.equal(childCalls, 2);
	assert.equal(completed.exitCode, 2);
	assert.equal(completed.result.status, 'error');
	assert.match(completed.result.failure ?? '', /GPU driver version/iu);
});
