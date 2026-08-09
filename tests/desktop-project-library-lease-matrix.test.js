/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createDesktopProjectLibraryLeaseMatrixPlan,
	DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS,
	formatDesktopProjectLibraryLeaseMatrix,
} from '../scripts/lib/desktop-project-library-lease-matrix.mjs';
import { decodeDesktopProjectLibraryLeaseSmokePlan } from '../desktop/project-library-lease-smoke.js';

const EXPECTED_WORKFLOWS = [
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
];

test('packaged lease qualification freezes all eight workflows and closed smoke controls', () => {
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS, EXPECTED_WORKFLOWS);
	const controlRoot = resolve('test-lease-control');
	const control = {
		ready: resolve(controlRoot, 'ready'),
		release: resolve(controlRoot, 'release'),
		result: resolve(controlRoot, 'result'),
		start: resolve(controlRoot, 'start'),
	};
	const plan = createDesktopProjectLibraryLeaseMatrixPlan({
		action: 'commit',
		control,
		productId: 'soundscaper',
		projectId: 'qualified-project',
		request: { document: '{}', expectedRevision: null },
	});
	const decoded = decodeDesktopProjectLibraryLeaseSmokePlan(
		Buffer.from(JSON.stringify(plan)).toString('base64url'),
	);
	assert.deepEqual(decoded, plan);
	assert.throws(() => decodeDesktopProjectLibraryLeaseSmokePlan(Buffer.from(JSON.stringify({
		...plan, faultPath: resolve(controlRoot, 'outside'),
	})).toString('base64url')), /closed object/iu);
});

test('desktop preview CI runs both packages on all five qualified-or-deferred targets and uploads JSON', async () => {
	const [workflow, runner] = await Promise.all([
		readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/lib/desktop-project-library-lease-matrix.mjs', import.meta.url), 'utf8'),
	]);
	for (const target of [
		['win', 'x64'], ['win', 'arm64'],
		['mac', 'arm64'],
		['linux', 'x64'], ['linux', 'arm64'],
	]) {
		assert.match(workflow, new RegExp(`platform: ${target[0]}[\\s\\S]{0,80}arch: ${target[1]}`, 'u'));
	}
	assert.match(workflow, /desktop:smoke:project-library-lease-matrix/u);
	assert.match(workflow, /for product in soundscaper framescaper/u);
	assert.match(workflow, /lease-matrix-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
	assert.match(runner, /runRendererLoss[\s\S]*waitForFile\(child\.control\.result\)/u);
	assert.match(runner, /managedDescriptors[\s\S]*catalog\?\.managedMediaDescriptors/u);
	assert.doesNotMatch(runner, /losingManagedMediaDescriptors:\s*\[\]/u);
	assert.ok(Buffer.byteLength(formatDesktopProjectLibraryLeaseMatrix({ cases: [] })) < 1024 * 1024);
});
