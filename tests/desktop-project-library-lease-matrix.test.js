/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	awaitLeaseMatrixControlFile,
	createDesktopProjectLibraryLeaseMatrixDocument,
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

test('current packaged lease qualification admits Soundscaper V11 and Framescaper V20', () => {
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
	const framescaper = { ...plan, productId: 'framescaper' };
	assert.deepEqual(decodeDesktopProjectLibraryLeaseSmokePlan(
		Buffer.from(JSON.stringify(framescaper)).toString('base64url'),
	), framescaper);
	assert.deepEqual([
		JSON.parse(createDesktopProjectLibraryLeaseMatrixDocument('sound', 7, 'Sound', 'soundscaper')).schemaVersion,
		JSON.parse(createDesktopProjectLibraryLeaseMatrixDocument('frame', 8, 'Frame', 'framescaper')).schemaVersion,
	], [30, 31]);
});

// The closure register splits release-qualification evidence from automated test
// activation: platformSet records what milestone 2 historically qualified, while
// testActivation records what CI must actually run. The packaged lease job has to
// be exactly testActivation.desktopTargets — no fewer, so an activated target
// cannot quietly stop running, and no more, so a retired target cannot reappear.
const DESKTOP_TARGET_PLATFORMS = new Map([['windows', 'win'], ['macos', 'mac'], ['linux', 'linux']]);

function desktopTargetCells(targetIds) {
	return targetIds.map((id) => {
		const [os, arch] = id.split('-');
		const platform = DESKTOP_TARGET_PLATFORMS.get(os);
		assert.ok(platform, `unknown desktop target OS in ${id}`);
		return `${platform}/${arch}`;
	}).sort();
}

test('desktop preview CI runs both selected products on every test-activated target', async () => {
	const [workflow, runner, closure] = await Promise.all([
		readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/lib/desktop-project-library-lease-matrix.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../config/milestone-2-closure.json', import.meta.url), 'utf8').then(JSON.parse),
	]);
	const jobMarker = '\n  soundscaper-project-library-lease-matrix:';
	const jobIndex = workflow.indexOf(jobMarker);
	assert.notEqual(jobIndex, -1, 'missing packaged lease job');
	const leaseJob = workflow.slice(jobIndex);
	const activated = desktopTargetCells(closure.testActivation.desktopTargets);
	assert.deepEqual(activated, ['linux/arm64', 'linux/x64', 'mac/arm64', 'win/arm64', 'win/x64']);
	for (const cell of activated) {
		const [platform, arch] = cell.split('/');
		assert.match(leaseJob, new RegExp(`platform: ${platform}\\n\\s+arch: ${arch}\\n`, 'u'), cell);
	}
	assert.deepEqual(
		[...leaseJob.matchAll(/^\s+platform: (\w+)\n\s+arch: (\w+)$/gmu)]
			.map(([, platform, arch]) => `${platform}/${arch}`).sort(),
		activated,
		'the packaged lease matrix must be exactly the test-activated desktop targets',
	);
	for (const cell of desktopTargetCells(closure.platformSet.retiredDesktopTargets)) {
		const [platform, arch] = cell.split('/');
		assert.doesNotMatch(leaseJob, new RegExp(`platform: ${platform}\\n\\s+arch: ${arch}\\n`, 'u'), cell);
	}
	assert.match(leaseJob, /for product in soundscaper framescaper/u);
	assert.match(leaseJob, /release\/desktop-lease-matrix\/\$product/u);
	assert.match(leaseJob, /desktop:smoke:project-library-lease-matrix/u);
	assert.match(leaseJob, /soundscaper-v11-framescaper-v20-lease-matrix-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
	assert.match(runner, /\[\s*'soundscaper',\s*'framescaper'\s*\]/u);
	assert.match(runner, /for \(const productId of \['soundscaper', 'framescaper'\]\)/u);
	assert.match(runner, /runRendererLoss[\s\S]*awaitLeaseMatrixControlFile\(child\.control\.result, child\)/u);
	assert.ok(Buffer.byteLength(formatDesktopProjectLibraryLeaseMatrix({ cases: [] })) < 1024 * 1024);
});

const ORDER = ['soundscaper', 'soundscaper'];

test('every per-product lease workflow keeps one writer instance alive at a time', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		for (const workflowId of DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS) {
			const record = await runDesktopProjectLibraryLeaseMatrixCase({
				driver: leaseInstances(), workflowId, order: [productId, productId],
			});
			assert.equal(record.workflowId, workflowId);
			assert.equal(record.order, `${productId}-then-${productId}`);
			assert.match(record.winningDocumentSha256, /^[a-f\d]{64}$/u);
		}
	}
});

test('the paired workflow proves simultaneous cross-product scope isolation', async () => {
	const record = await runDesktopProjectLibraryLeaseMatrixCase({
		driver: isolatedProductInstances(),
		workflowId: 'cross-product-simultaneous-open',
		order: ['soundscaper', 'framescaper'],
	});
	assert.equal(record.order, 'soundscaper-then-framescaper');
	assert.equal(record.refusedInstances, 0);
	assert.deepEqual(record.fencingTokens, [1, 2, 1, 3, 2]);
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
	// The matrix runs nightly against a packaged product, so a refusal has to carry what it
	// saw: reporting the claim alone costs a whole nightly to learn the observed status.
	await assert.rejects(runDesktopProjectLibraryLeaseMatrixCase({
		driver: leaseInstances({ settleAbandonedPublication: true }),
		workflowId: 'renderer-loss-during-operation',
		order: ORDER,
	}), (error) => {
		assert.match(error.message, /abandoned publication canonical: \{/u);
		assert.match(error.message, /"status"/u);
		return true;
	});
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

test('the desktop smoke probe carries the product-neutral lease qualification seam', () => {
	const probe = createDesktopSmokeProbe({
		argv: ['electron', '.'],
		appName: 'Soundscaper',
		appOrigin: 'app://soundscaper.local',
		productId: 'soundscaper',
		exit: () => undefined,
	});
	assert.equal(probe.projectLibraryLeaseQualification(), null);
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
 * Packaged Soundscaper V11 instances reduced to what the matrix decides on: one
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

	const acquire = (productId) => {
		if (lease && !faults.admitSecondInstance) {
			throw new Error(`${productId === 'framescaper' ? 'Framescaper desktop V20' : 'Soundscaper desktop V11'} writer lease is busy`);
		}
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

	function snapshot(productId, holder, activePublication) {
		return {
			closed: false,
			fenced: false,
			owner: { product: productId, processId: holder.processId, instanceId: holder.instanceId },
			activeSessions: 1,
			activePublication,
			writer: {
				fencingToken: holder.fencingToken,
				tookOverStaleLease: holder.tookOverStaleLease,
				recovery: holder.recovery,
			},
		};
	}

	function payload(productId, action, holder, rendererResult) {
		return {
			schemaVersion: 1,
			action,
			productId,
			renderer: rendererResult,
			host: snapshot(productId, holder, false),
			catalog: {
				revision: library.revision,
				projectSha256: library.sha256,
				managedMediaBodyCount: faults.managedMediaBodyCount ?? 0,
			},
		};
	}

	return Object.freeze({
		async commit(productId, action, _projectId, commitRequest) {
			const holder = acquire(productId);
			const result = payload(productId, action, holder, renderer(action, commitRequest));
			lease = null;
			return result;
		},
		async hold(productId, action, _projectId, commitRequest) {
			const holder = acquire(productId);
			let result = null;
			const settle = () => {
				result ??= payload(productId, action, holder, renderer(action, commitRequest));
				return result;
			};
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
		async crash(productId, action, _projectId, commitRequest) {
			const holder = acquire(productId);
			const checkpoint = {
				phase: action === 'crash-committed' ? 'committed' : 'prepared',
				processId: holder.processId,
				host: snapshot(productId, holder, true),
			};
			abandon(action === 'crash-committed'
				? { outcome: 'committed', document: commitRequest.document }
				: { outcome: 'rolled-back', document: null });
			return checkpoint;
		},
		async rendererLoss(productId, _projectId, commitRequest) {
			const holder = acquire(productId);
			const checkpoint = {
				phase: 'prepared',
				processId: holder.processId,
				host: snapshot(productId, holder, !faults.idleCheckpoint),
			};
			if (faults.settleAbandonedPublication) commit(commitRequest.document);
			const recovered = payload(productId, 'renderer-loss', holder, renderer('commit', commitRequest));
			lease = null;
			return [checkpoint, recovered];
		},
	});
}

function isolatedProductInstances() {
	const states = new Map(['soundscaper', 'framescaper'].map((productId) => [productId, {
		document: null, issued: 0, lease: null,
	}]));
	const stateFor = (productId) => states.get(productId);
	const acquire = (productId) => {
		const state = stateFor(productId);
		if (state.lease) throw new Error(`${productId} writer lease is busy`);
		state.issued += 1;
		state.lease = {
			fencingToken: state.issued,
			instanceId: `${productId}-${String(state.issued)}`,
			processId: 8_000 + state.issued,
		};
		return state.lease;
	};
	const payload = (productId, action, holder, renderer) => {
		const state = stateFor(productId);
		const sha256 = state.document === null ? null
			: createHash('sha256').update(state.document).digest('hex');
		return {
			action,
			productId,
			renderer,
			host: {
				owner: { product: productId, instanceId: holder.instanceId },
				writer: { fencingToken: holder.fencingToken },
			},
			catalog: { projectSha256: sha256, managedMediaBodyCount: 0 },
		};
	};
	const observe = (productId) => {
		const state = stateFor(productId);
		return {
			status: 'observed',
			document: state.document,
			projectSha256: state.document === null ? null
				: createHash('sha256').update(state.document).digest('hex'),
		};
	};
	return Object.freeze({
		async commit(productId, action, _projectId, request) {
			const state = stateFor(productId);
			const holder = acquire(productId);
			let renderer;
			if (action === 'verify') renderer = observe(productId);
			else {
				state.document = request.document;
				renderer = { status: 'committed', document: state.document,
					projectSha256: createHash('sha256').update(state.document).digest('hex') };
			}
			state.lease = null;
			return payload(productId, action, holder, renderer);
		},
		async hold(productId, action) {
			const state = stateFor(productId);
			const holder = acquire(productId);
			let result = null;
			return {
				get result() { return result; },
				start: async () => undefined,
				waitResult: async () => {
					result ??= payload(productId, action, holder, observe(productId));
					return result;
				},
				release: async () => { state.lease = null; },
			};
		},
	});
}
