/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { runDualOriginPhaseFixture } from './helpers/nightly-tests-dual-origin-phase.ts';
import { nightlyProductSitesFixture } from './helpers/nightly-tests-product-sites.ts';

test('partial packaged-runtime metadata does not abort diagnostics', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-late-error-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	let childCalls = 0;
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '1.0.0-rc.1' },
		platform: 'linux',
		arch: 'x64',
		sourceRevision: '1'.repeat(40),
		environment: { SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION: '555.42.02' },
	}, {
		runDualOriginPhase: runDualOriginPhaseFixture,
		startProductSites: nightlyProductSitesFixture(49996),
		runPlaywright: async () => {
			childCalls += 1;
			return { code: 0, signal: null };
		},
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
		preserveCoverageEvidence: async () => '/tmp/nightly-build-evidence',
	});

	assert.equal(childCalls, 6);
	assert.equal(completed.exitCode, 0);
	assert.equal(completed.result.status, 'passed');
	assert.equal(completed.result.failure, null);
});
