/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsProgressBar,
} from '../scripts/lib/desktop-nightly-tests-presentation.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { runDualOriginPhaseFixture } from './helpers/nightly-tests-dual-origin-phase.ts';
import { nightlyProductSitesFixture } from './helpers/nightly-tests-product-sites.ts';

test('unavailable GUI-launch stdout cannot abort nightly tests', () => {
	for (const asynchronous of [false, true]) {
		const errors: unknown[] = [];
		const output = Object.assign(new EventEmitter(), {
			write: () => { if (!asynchronous) throw new Error('stdout is unavailable'); },
		});
		const progress = createDesktopNightlyTestsProgressBar({
			output, onError: (error: unknown) => { errors.push(error); },
		});
		assert.doesNotThrow(() => progress.update({ completed: 0, total: 4, label: 'Application launched' }));
		if (asynchronous) assert.doesNotThrow(() => output.emit('error', new Error('stdout is unavailable')));
		assert.doesNotThrow(() => progress.finish({ completed: 4, total: 4, label: 'Tests passed' }));
		assert.equal(errors.length, 1);
	}
});

test('the nightly CLI progress bar preserves every update when output is redirected', () => {
	const writes: string[] = [];
	const progress = createDesktopNightlyTestsProgressBar({
		output: { isTTY: false, write: (value: string) => { writes.push(value); return true; } },
	});

	progress.update({ completed: 0, total: 4, label: 'Application launched' });
	progress.update({ completed: 1, total: 4, label: 'Performance diagnostics' });
	progress.finish({ completed: 4, total: 4, label: 'Tests passed' });

	assert.deepEqual(writes, [
		'[--------------------] 0/4 0% Application launched\n',
		'[#####---------------] 1/4 25% Performance diagnostics\n',
		'[####################] 4/4 100% Tests passed\n',
	]);
});

test('the nightly CLI progress bar redraws one line on a terminal and refuses invalid updates', () => {
	const writes: string[] = [];
	const progress = createDesktopNightlyTestsProgressBar({
		output: { isTTY: true, write: (value: string) => { writes.push(value); return true; } },
	});

	progress.update({ completed: 0, total: 4, label: 'Application launched' });
	progress.finish({ completed: 3, total: 4, label: 'Tests interrupted' });

	assert.equal(writes[0], '\r[--------------------] 0/4 0% Application launched\u001B[K');
	assert.equal(writes[1], '\r[###############-----] 3/4 75% Tests interrupted\u001B[K\n');
	assert.throws(
		() => progress.update({ completed: 5, total: 4, label: 'Invalid' }),
		/progress.*completed/iu,
	);
});

test('the nightly runtime reports which serial test phase is active', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-progress-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const updates: Array<{ completed: number; total: number; label: string }> = [];
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '1.0.0-rc.1' },
		platform: 'linux',
		arch: 'x64',
		environment: {},
		onProgress: (update) => { updates.push(update); },
	}, {
		runDualOriginPhase: runDualOriginPhaseFixture,
		startProductSites: nightlyProductSitesFixture(50100),
		runPlaywright: async () => ({ code: 0, signal: null }),
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
		preserveCoverageEvidence: async () => '/tmp/coverage-evidence',
	});

	assert.equal(completed.exitCode, 0);
	assert.deepEqual(updates, [
		{ completed: 0, total: 6, label: 'Browser tests' },
		{ completed: 1, total: 6, label: 'Dual-origin browser coverage' },
		{ completed: 2, total: 6, label: 'Performance diagnostics' },
		{ completed: 3, total: 6, label: 'Packaged app diagnostics' },
		{ completed: 4, total: 6, label: 'Packaged app coverage' },
		{ completed: 5, total: 6, label: 'Local model tests' },
	]);
});
