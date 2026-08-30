/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperPersistentDeliveryWorker } from '../src/common/editor/controller/soundscaper-persistent-delivery-worker.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { fingerprintSoundscaperDeliveryPlanV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';

const JOB = '1'.repeat(48);
const CLAIM = '2'.repeat(48);
const PROJECT = Object.freeze({
	projectId: 'project-1', projectRevision: 7, projectSha256: 'a'.repeat(64),
});
const MEMBER = Object.freeze({
	memberId: 'member-1', label: 'WAV', presetId: 'preset-1', target: { kind: 'project' as const },
	mode: 'mix' as const, settings: { format: 'wav' },
});

test('worker re-derives one exact member, carries its fingerprint, and executes the claimed ordinary plan', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: {
			list: async () => listed ? page([]) : (listed = true, page([entry(plan)])),
		},
		workerTransport: {
			claimNext: async (value) => {
				calls.push({ name: 'claim', value });
				return capability(plan, calls);
			},
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({
				settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 },
			}),
			executePersistentAudioDeliveryPlan: async (value) => {
				calls.push({ name: 'execute', value });
				value.onProgress?.(0.25);
				value.onProgress?.(0.75);
				return { fileName: 'mix.wav', size: 4 };
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	await worker.wake();
	const claim = calls.find(({ name }) => name === 'claim')!.value as {
		jobId: string; currentAuthority: { planFingerprint: string };
	};
	assert.equal(claim.jobId, JOB);
	assert.equal(claim.currentAuthority.planFingerprint, fingerprintSoundscaperDeliveryPlanV1(plan).sha256);
	const execution = calls.find(({ name }) => name === 'execute')!.value as Record<string, unknown>;
	assert.deepEqual(execution.settings, plan.settings);
	assert.deepEqual(execution.exportPlan, plan.exportPlan);
	assert.deepEqual(execution.destination, {
		kind: 'soundscaper-persistent-delivery-save-target-v1', claimId: CLAIM,
	});
	assert.deepEqual(calls.filter(({ name }) => name === 'progress').map(({ value }) => value), [
		{ claimId: CLAIM, progress: 0 }, { claimId: CLAIM, progress: 0.25 },
		{ claimId: CLAIM, progress: 0.75 }, { claimId: CLAIM, progress: 1 },
	]);
	assert.equal(calls.filter(({ name }) => name === 'complete').length, 1);
	assert.equal(calls.filter(({ name }) => name === 'fail').length, 0);
	await worker.dispose();
});

test('worker executes an exact persistent plan whose optional batch authority is null', async () => {
	const plan = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 }, batch: null,
	});
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async (value) => {
				calls.push({ name: 'claim', value });
				return capability(plan, calls);
			},
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({
				settings: plan.settings, exportPlan: plan.exportPlan,
			}),
			executePersistentAudioDeliveryPlan: async (value) => {
				calls.push({ name: 'execute', value });
				return { fileName: 'mix.wav', size: 4 };
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	await worker.wake();
	assert.equal(calls.filter(({ name }) => name === 'claim').length, 1);
	assert.equal(calls.filter(({ name }) => name === 'execute').length, 1);
	assert.equal(calls.filter(({ name }) => name === 'complete').length, 1);
	await worker.dispose();
});

test('project invalidation during a non-batch claim releases it before any ordinary execution', async () => {
	const plan = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 }, batch: null,
	});
	let releaseClaim!: () => void;
	let signalClaimStarted!: () => void;
	const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
	const claimStarted = new Promise<void>((resolve) => { signalClaimStarted = resolve; });
	const releases: string[] = [];
	let executions = 0;
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async () => {
				signalClaimStarted();
				await claimGate;
				return capability(plan, [], releases);
			},
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => {
				executions += 1;
				return { fileName: 'must-not-run.wav', size: 4 };
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	const waking = worker.wake();
	await claimStarted;
	await worker.projectChanged();
	releaseClaim();
	await waking;
	assert.equal(executions, 0);
	assert.deepEqual(releases, [CLAIM]);
	await worker.dispose();
});

test('project invalidation during batch derivation prevents claiming stale open-generation work', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	let releaseDerivation!: () => void;
	let signalDeriving!: () => void;
	const derivationGate = new Promise<void>((resolve) => { releaseDerivation = resolve; });
	const deriving = new Promise<void>((resolve) => { signalDeriving = resolve; });
	let claims = 0;
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async () => { claims += 1; return capability(plan, []); },
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => {
				signalDeriving();
				await derivationGate;
				return { settings: plan.settings, exportPlan: plan.exportPlan };
			},
			executePersistentAudioDeliveryPlan: async () => { throw new Error('must not execute'); },
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	const waking = worker.wake();
	await deriving;
	await worker.projectChanged();
	releaseDerivation();
	await waking;
	assert.equal(claims, 0);
	await worker.dispose();
});

test('worker offers a changed re-derived fingerprint to main so the exact queued job becomes stale', async () => {
	const queuedPlan = persistentPlan({ format: 'wav', outputFrames: 4 });
	const currentPlan = persistentPlan({ format: 'wav', outputFrames: 8 });
	let offered: unknown;
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: {
			list: async () => listed ? page([]) : (listed = true, page([entry(queuedPlan)])),
		},
		workerTransport: {
			claimNext: async (value) => { offered = value; return null; },
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({
				settings: currentPlan.settings, exportPlan: currentPlan.exportPlan,
			}),
			executePersistentAudioDeliveryPlan: async () => { throw new Error('must not execute'); },
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	await worker.wake();
	assert.equal((offered as { jobId: string }).jobId, JOB);
	assert.equal(
		(offered as { currentAuthority: { planFingerprint: string } }).currentAuthority.planFingerprint,
		fingerprintSoundscaperDeliveryPlanV1(currentPlan).sha256,
	);
	assert.notEqual(
		fingerprintSoundscaperDeliveryPlanV1(currentPlan).sha256,
		fingerprintSoundscaperDeliveryPlanV1(queuedPlan).sha256,
	);
	const changedSettings = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav', sampleRate: 44_100 }, exportPlan: queuedPlan.exportPlan,
		batch: queuedPlan.batch,
	});
	assert.notEqual(
		fingerprintSoundscaperDeliveryPlanV1(changedSettings).sha256,
		fingerprintSoundscaperDeliveryPlanV1(queuedPlan).sha256,
		'normalized settings and the exact export plan are independent authority inputs',
	);
	await worker.dispose();
});

test('worker offers a newer saved revision for the same project id so main can persist stale-project', async () => {
	const queuedPlan = persistentPlan({ format: 'wav', outputFrames: 4 });
	const currentProject = Object.freeze({
		...PROJECT, projectRevision: PROJECT.projectRevision + 1, projectSha256: 'b'.repeat(64),
	});
	let offered: unknown;
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(queuedPlan)])) },
		workerTransport: { claimNext: async (value) => { offered = value; return null; } },
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({
				settings: queuedPlan.settings, exportPlan: queuedPlan.exportPlan,
			}),
			executePersistentAudioDeliveryPlan: async () => { throw new Error('must not execute'); },
		},
		currentProjectIdentity: () => currentProject,
		deliveryReport: report,
	});
	await worker.wake();
	assert.deepEqual(
		(offered as { currentAuthority: { projectIdentity: unknown } }).currentAuthority.projectIdentity,
		currentProject,
	);
	assert.equal((offered as { jobId: string }).jobId, JOB);
	await worker.dispose();
});

test('cancelJob cancels and releases only the matching active ordinary export', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	let rejectExecution!: (error: unknown) => void;
	let signalExecuting!: () => void;
	const executing = new Promise<void>((resolve) => { signalExecuting = resolve; });
	const releases: string[] = [];
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: {
			list: async () => listed ? page([]) : (listed = true, page([entry(plan)])),
		},
		workerTransport: {
			claimNext: async () => capability(plan, [], releases),
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => {
				signalExecuting();
				return new Promise((_, reject) => { rejectExecution = reject; });
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
		cancelExport: () => { rejectExecution(new DOMException('cancelled', 'AbortError')); },
	});
	void worker.wake();
	await executing;
	assert.equal(await worker.cancelJob('f'.repeat(48)), false);
	assert.equal(await worker.cancelJob(JOB), true);
	assert.deepEqual(releases, [CLAIM]);
	await worker.dispose();
});

test('a busy direct export requeues the persistent claim and idle invalidation never cancels it', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	let cancels = 0;
	let listed = false;
	const releases: string[] = [];
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: {
			list: async () => listed ? page([]) : (listed = true, page([entry(plan)])),
		},
		workerTransport: {
			claimNext: async () => capability(plan, [], releases),
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => ({ busy: true }),
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
		cancelExport: () => { cancels += 1; },
	});
	await worker.wake();
	assert.deepEqual(releases, [CLAIM]);
	await worker.projectChanged();
	assert.equal(cancels, 0);
	await worker.dispose();
});

test('worker settles queued progress before finishing an ordinary-export failure', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	let releaseProgress!: () => void;
	let signalProgress!: () => void;
	const progressGate = new Promise<void>((resolve) => { releaseProgress = resolve; });
	const progressStarted = new Promise<void>((resolve) => { signalProgress = resolve; });
	let failed = 0;
	let persistedFailureReport: unknown = null;
	let listed = false;
	const base = capability(plan, []);
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async () => Object.freeze({
				...base,
				progress: async (progress: number) => {
					if (progress !== 0.5) return;
					signalProgress();
					await progressGate;
				},
				fail: async (_code: string, failureReport: unknown) => {
					failed += 1;
					persistedFailureReport = failureReport;
				},
			}),
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async ({ onProgress }) => {
				onProgress?.(0.5);
				throw new Error('ordinary render failed');
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	const waking = worker.wake();
	await progressStarted;
	let settled = false;
	void waking.then(() => { settled = true; }, () => { settled = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	releaseProgress();
	await waking;
	assert.equal(failed, 1);
	assert.deepEqual(persistedFailureReport, report(), 'the sealed ordinary report accompanies failure');
	await worker.dispose();
});

test('a refused terminal failure releases the acquired claim instead of leaving it running', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	const releases: string[] = [];
	let listed = false;
	const base = capability(plan, [], releases);
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async () => Object.freeze({
				...base,
				fail: async () => { throw new Error('terminal failure refused'); },
			}),
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => { throw new Error('ordinary render failed'); },
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	await assert.rejects(worker.wake(), /terminal failure refused/u);
	assert.deepEqual(releases, [CLAIM]);
	await worker.dispose();
});

test('malformed claimed plan validation releases renderer ownership before surfacing the error', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	const releases: string[] = [];
	let listed = false;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: { list: async () => listed ? page([]) : (listed = true, page([entry(plan)])) },
		workerTransport: {
			claimNext: async () => Object.freeze({
				...capability(plan, [], releases), plan: Object.freeze({ malformed: true }),
			}),
		},
		exportService: {
			...availability(),
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => { throw new Error('must not execute'); },
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	await assert.rejects(worker.wake(), /persistent audio delivery plan|missing|unsupported/iu);
	assert.deepEqual(releases, [CLAIM]);
	await worker.dispose();
});

test('worker waits without claiming while direct export owns execution and resumes on its idle signal', async () => {
	const plan = persistentPlan({ format: 'wav', outputFrames: 4 });
	let available = false;
	let signalIdle!: () => void;
	const idle = new Promise<void>((resolve) => { signalIdle = resolve; });
	let claims = 0;
	let lists = 0;
	let executions = 0;
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: {
			list: async () => {
				lists += 1;
				return lists === 1 ? page([entry(plan)]) : page([]);
			},
		},
		workerTransport: {
			claimNext: async () => { claims += 1; return capability(plan, []); },
		},
		exportService: {
			persistentAudioDeliveryAvailable: () => available,
			whenPersistentAudioDeliveryAvailable: () => idle,
			derivePersistentAudioDeliveryPlan: async () => ({ settings: plan.settings, exportPlan: plan.exportPlan }),
			executePersistentAudioDeliveryPlan: async () => {
				executions += 1;
				return { fileName: 'mix.wav', size: 4 };
			},
		},
		currentProjectIdentity: () => PROJECT,
		deliveryReport: report,
	});
	const waking = worker.wake();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(lists, 0);
	assert.equal(claims, 0);
	available = true;
	signalIdle();
	await waking;
	assert.equal(claims, 1);
	assert.equal(executions, 1);
	await worker.dispose();
});

function persistentPlan(exportPlan: Readonly<Record<string, unknown>>) {
	return createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav' }, exportPlan,
		batch: {
			batchId: 'batch-1', memberId: MEMBER.memberId, presetId: MEMBER.presetId,
			target: MEMBER.target, mode: MEMBER.mode,
		},
	});
}

function entry(plan: ReturnType<typeof persistentPlan>) {
	return Object.freeze({
		jobId: JOB, state: 'waiting-for-project', projectIdentity: PROJECT,
		planFingerprint: fingerprintSoundscaperDeliveryPlanV1(plan).sha256,
		batchId: plan.batch?.batchId ?? null, batchMember: plan.batch === null ? null : MEMBER,
	});
}

function page(entries: readonly ReturnType<typeof entry>[]) {
	return Object.freeze({ entries, paused: false, nextCursor: null });
}

function capability(
	plan: ReturnType<typeof persistentPlan>,
	calls: Array<Readonly<{ name: string; value?: unknown }>>,
	releases: string[] = [],
) {
	return Object.freeze({
		jobId: JOB,
		claimId: CLAIM,
		plan,
		progress: async (progress: number) => { calls.push({ name: 'progress', value: { claimId: CLAIM, progress } }); },
		beginWrite: async () => ({ writeId: '3'.repeat(48), chunkSize: 4 * 1024 * 1024 }),
		writeChunk: async () => ({ nextOffset: 0 }),
		patchFinalPrefix: async () => ({ byteLength: 0 }),
		finishWrite: async () => ({ byteLength: 0 }),
		abortWrite: async () => undefined,
		complete: async (value: unknown) => { calls.push({ name: 'complete', value }); },
		fail: async (failureCode: unknown, failureReport: unknown) => {
			calls.push({ name: 'fail', value: { failureCode, failureReport } });
		},
		release: async () => { releases.push(CLAIM); calls.push({ name: 'release', value: { claimId: CLAIM } }); },
	});
}

function availability() {
	return {
		persistentAudioDeliveryAvailable: () => true,
		whenPersistentAudioDeliveryAvailable: async () => undefined,
	};
}

function report() {
	return Object.freeze({
		schemaVersion: 1 as const, format: 'delivery' as const, direction: 'export' as const,
		subject: {
			format: 'wav', container: 'riff', codec: 'pcm-s24le', sampleRate: 48_000,
			channelCount: 2, lossless: true,
		},
		items: Object.freeze([]),
		counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	});
}
