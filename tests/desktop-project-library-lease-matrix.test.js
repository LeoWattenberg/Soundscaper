/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createDesktopProjectLibraryLeaseMatrixPlan,
	DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS,
	DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS,
	formatDesktopProjectLibraryLeaseMatrix,
} from '../scripts/lib/desktop-project-library-lease-matrix.mjs';
import { decodeDesktopProjectLibraryLeaseSmokePlan } from '../desktop/project-library-lease-smoke.js';

const EXPECTED_WORKFLOWS = [
	'same-project-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
];

const HISTORICAL_WORKFLOWS = [
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
];

test('current packaged V10 lease qualification is Soundscaper-only while preserving historical IDs', () => {
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS, EXPECTED_WORKFLOWS);
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS, HISTORICAL_WORKFLOWS);
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
	assert.throws(() => decodeDesktopProjectLibraryLeaseSmokePlan(Buffer.from(JSON.stringify({
		...plan, productId: 'framescaper',
	})).toString('base64url')), /Soundscaper|V10|product/iu);
});

test('desktop preview CI runs the V10 matrix only for Soundscaper on qualified targets', async () => {
	const [workflow, runner] = await Promise.all([
		readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/lib/desktop-project-library-lease-matrix.mjs', import.meta.url), 'utf8'),
	]);
	const jobMarker = '\n  soundscaper-project-library-lease-matrix:';
	const jobIndex = workflow.indexOf(jobMarker);
	assert.notEqual(jobIndex, -1, 'missing Soundscaper-only packaged lease job');
	const leaseJob = workflow.slice(jobIndex);
	for (const target of [
		['win', 'x64'], ['linux', 'x64'],
	]) {
		assert.match(leaseJob, new RegExp(`platform: ${target[0]}[\\s\\S]{0,80}arch: ${target[1]}`, 'u'));
	}
	assert.doesNotMatch(leaseJob, /product in soundscaper framescaper|SCAPE_PRODUCT=["']?framescaper/iu);
	assert.doesNotMatch(leaseJob, /platform: (?:mac|win)[\s\S]{0,80}arch: arm64|platform: linux[\s\S]{0,80}arch: arm64/u);
	assert.match(leaseJob, /SCAPE_PRODUCT=soundscaper/u);
	assert.match(leaseJob, /desktop:smoke:project-library-lease-matrix/u);
	assert.match(leaseJob, /soundscaper-v10-lease-matrix-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
	assert.doesNotMatch(runner, /\[\s*'soundscaper',\s*'framescaper'\s*\]|\[\s*'framescaper',\s*'soundscaper'\s*\]/u);
	assert.match(runner, /runRendererLoss[\s\S]*waitForFile\(child\.control\.result\)/u);
	assert.match(runner, /bodyCounts[\s\S]*catalog\?\.managedMediaBodyCount/u);
	assert.doesNotMatch(runner, /losingManagedMediaBodyCounts:\s*\[\]/u);
	assert.ok(Buffer.byteLength(formatDesktopProjectLibraryLeaseMatrix({ cases: [] })) < 1024 * 1024);
});
