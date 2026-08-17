/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	awaitLeaseMatrixControlFile,
	createDesktopProjectLibraryLeaseMatrixPlan,
	DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS,
	DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS,
	formatDesktopProjectLibraryLeaseMatrix,
	runDesktopProjectLibraryLeaseMatrixCase,
} from '../scripts/lib/desktop-project-library-lease-matrix.mjs';
import { createDesktopSmokeProbe } from '../desktop/desktop-smoke.js';
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
	assert.match(runner, /runRendererLoss[\s\S]*awaitLeaseMatrixControlFile\(child\.control\.result, child\)/u);
	assert.ok(Buffer.byteLength(formatDesktopProjectLibraryLeaseMatrix({ cases: [] })) < 1024 * 1024);
});

const ORDER = ['soundscaper', 'soundscaper'];

test('every V10 lease workflow keeps one writer instance alive at a time', async () => {
	for (const workflowId of DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS) {
		const record = await runDesktopProjectLibraryLeaseMatrixCase({
			driver: leaseInstances(), workflowId, order: ORDER,
		});
		assert.equal(record.workflowId, workflowId);
		assert.equal(record.order, 'soundscaper-then-soundscaper');
		assert.match(record.winningDocumentSha256, /^[a-f\d]{64}$/u);
	}
});

test('a second instance is refused rather than admitted beside the lease holder', async () => {
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ admitSecondInstance: true }),
		workflowId: 'same-project-simultaneous-open',
		order: ORDER,
	}), /admitted while the writer lease was held/u);
	const record = await runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances(), workflowId: 'same-project-simultaneous-open', order: ORDER,
	});
	assert.equal(record.refusedInstances, 1);
});

test('the losing canonical contender must lose main compare-and-swap, not merely fail', async () => {
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ loserReason: 'closed-session' }),
		workflowId: 'conflicting-canonical-commit',
		order: ORDER,
	}), /compare-and-swap/u);
});

test('fencing tokens repeat within one holder and advance across acquisitions', async () => {
	const held = await runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances(), workflowId: 'renderer-loss-during-operation', order: ORDER,
	});
	assert.deepEqual(held.fencingTokens, [1, 1]);
	const transferred = await runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances(), workflowId: 'writer-lease-transfer', order: ORDER,
	});
	assert.deepEqual(transferred.fencingTokens, [1, 2]);
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ frozenFencingToken: true }),
		workflowId: 'writer-lease-transfer',
		order: ORDER,
	}), /fencing token did not advance across acquisitions/u);
});

test('renderer loss must interrupt a publication that never becomes canonical', async () => {
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ settleAbandonedPublication: true }),
		workflowId: 'renderer-loss-during-operation',
		order: ORDER,
	}), /abandoned publication/iu);
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ idleCheckpoint: true }),
		workflowId: 'renderer-loss-during-operation',
		order: ORDER,
	}), /in-flight publication/iu);
});

test('a workflow that advertises a managed-media body fails the source-free matrix', async () => {
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ managedMediaBodyCount: 1 }),
		workflowId: 'orderly-process-restart',
		order: ORDER,
	}), /managed-media body/u);
	const record = await runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances(), workflowId: 'orderly-process-restart', order: ORDER,
	});
	assert.deepEqual(record.losingManagedMediaBodyCounts, [0, 0]);
});

test('the desktop smoke probe carries the V10 qualification seam and nothing older', () => {
	const probe = createDesktopSmokeProbe({
		argv: ['electron', '.'],
		appName: 'Soundscaper',
		appOrigin: 'app://soundscaper.local',
		productId: 'soundscaper',
		exit: () => undefined,
	});
	assert.equal(probe.projectLibraryV10Qualification(), null);
	assert.equal(probe.projectLibraryHostOptions, undefined);
});

test('a control file that never arrives reports the child rather than only its path', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-lease-matrix-control-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const present = join(root, 'ready.json');
	await writeFile(present, '{"action":"commit"}');

	assert.equal(
		await awaitLeaseMatrixControlFile(present, { child: { exitCode: null, signalCode: null }, output: '' }),
		'{"action":"commit"}',
	);

	// A child that has gone will never write the file, so the wait must end at its
	// exit and carry what it printed. Polling out the remaining 90-second budget
	// and then naming only the path is what made the deadlock in the crash
	// checkpoint unreadable in CI.
	const started = performance.now();
	await assert.rejects(
		awaitLeaseMatrixControlFile(join(root, 'result.json'), {
			child: { exitCode: 2, signalCode: null },
			output: 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_LEASE failed: the reason',
		}),
		(error) => {
			assert.match(error.message, /exited before writing/u);
			assert.match(error.message, /child exit 2\/null/u);
			assert.match(error.message, /LEASE failed: the reason/u);
			return true;
		},
	);
	assert.ok(performance.now() - started < 5_000, 'the wait must end at the child, not at its timeout');
});

/**
 * Packaged Soundscaper V10 instances reduced to what the matrix decides on: one
 * writer lease per process lifetime, a catalog main arbitrates, and the evidence
 * each child prints. Faults stage the misbehaviour each assertion exists to catch.
 */
function leaseInstances(faults = {}) {
	const library = { revision: null, sha256: null };
	let lease = null;
	let issued = 0;
	let instances = 0;
	let staleLease = false;
	let pending = null;

	const acquire = () => {
		if (lease && !faults.admitSecondInstance) throw new Error('Soundscaper desktop V10 writer lease is busy');
		issued += 1;
		instances += 1;
		const recovery = pending ?? { outcome: 'clean', document: null };
		pending = null;
		if (recovery.document) commit(recovery.document);
		lease = {
			instanceId: `instance-${String(instances)}`,
			processId: 4_000 + instances,
			fencingToken: faults.frozenFencingToken ? 1 : issued,
			tookOverStaleLease: staleLease,
			recovery: { outcome: recovery.outcome },
		};
		staleLease = false;
		return lease;
	};
	const abandon = (recovery) => { pending = recovery; staleLease = true; lease = null; };

	function commit(text) {
		library.revision = JSON.parse(text).revision;
		library.sha256 = createHash('sha256').update(text).digest('hex');
	}

	function renderer(action, commitRequest) {
		const observed = { projectRevision: library.revision, projectSha256: library.sha256 };
		if (action === 'observe-hold' || action === 'verify') return { status: 'observed', ...observed };
		const present = library.revision !== null;
		if ((commitRequest.expectedRevision === null) === present) {
			return { status: 'conflict', ...observed, reason: 'destination-presence' };
		}
		if (action === 'commit-contend' && present && library.revision !== commitRequest.expectedRevision) {
			return { status: 'conflict', ...observed, reason: faults.loserReason ?? 'compare-and-swap' };
		}
		commit(commitRequest.document);
		return { status: 'committed', projectRevision: library.revision, projectSha256: library.sha256 };
	}

	function snapshot(holder, activePublication) {
		return {
			closed: false,
			fenced: false,
			owner: { product: 'soundscaper', processId: holder.processId, instanceId: holder.instanceId },
			activeSessions: 1,
			activePublication,
			writer: {
				fencingToken: holder.fencingToken,
				tookOverStaleLease: holder.tookOverStaleLease,
				recovery: holder.recovery,
			},
		};
	}

	function payload(action, holder, rendererResult) {
		return {
			schemaVersion: 1,
			action,
			productId: 'soundscaper',
			renderer: rendererResult,
			host: snapshot(holder, false),
			catalog: {
				revision: library.revision,
				projectSha256: library.sha256,
				managedMediaBodyCount: faults.managedMediaBodyCount ?? 0,
			},
		};
	}

	return Object.freeze({
		async commit(_productId, action, _projectId, commitRequest) {
			const holder = acquire();
			const result = payload(action, holder, renderer(action, commitRequest));
			lease = null;
			return result;
		},
		async hold(_productId, action, _projectId, commitRequest) {
			const holder = acquire();
			let result = null;
			const settle = () => { result ??= payload(action, holder, renderer(action, commitRequest)); return result; };
			return {
				get result() { return result; },
				start: async () => undefined,
				waitResult: async () => settle(),
				release: async () => { settle(); lease = null; },
			};
		},
		async refuse() {
			if (!lease) throw new Error('Lease matrix refusal was expected while no writer lease was held');
			if (faults.admitSecondInstance) {
				throw new Error('Lease matrix second instance was admitted while the writer lease was held');
			}
			return { refused: 'writer-lease-busy' };
		},
		async crash(_productId, action, _projectId, commitRequest) {
			const holder = acquire();
			const checkpoint = {
				phase: action === 'crash-committed' ? 'committed' : 'prepared',
				processId: holder.processId,
				host: snapshot(holder, true),
			};
			abandon(action === 'crash-committed'
				? { outcome: 'committed', document: commitRequest.document }
				: { outcome: 'rolled-back', document: null });
			return checkpoint;
		},
		async rendererLoss(_productId, _projectId, commitRequest) {
			const holder = acquire();
			const checkpoint = {
				phase: 'prepared',
				processId: holder.processId,
				host: snapshot(holder, !faults.idleCheckpoint),
			};
			if (faults.settleAbandonedPublication) commit(commitRequest.document);
			const recovered = payload('renderer-loss', holder, renderer('commit', commitRequest));
			lease = null;
			return [checkpoint, recovered];
		},
	});
}
