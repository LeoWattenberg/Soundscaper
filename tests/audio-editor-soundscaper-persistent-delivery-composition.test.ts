/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
	validateSoundscaperPersistentDeliveryBatchMemberV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import {
	fingerprintSoundscaperDeliveryPlanV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentDeliveryControllerComposition,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-controller-composition.ts';
import type {
	SoundscaperPersistentDeliverySummary,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-ui-service.ts';

const PROJECT_SHA = 'ab'.repeat(32);
const PROJECT_IDENTITY = Object.freeze({
	projectId: 'project-1', projectRevision: 7, projectSha256: PROJECT_SHA,
});
const SETTINGS = Object.freeze({ format: 'flac', mode: 'mix', range: 'project' });
const EXPORT_PLAN = Object.freeze({ format: 'flac', outputFrames: 48_000, version: 1 });
const PLAN = createSoundscaperPersistentAudioDeliveryPlanV1({
	settings: SETTINGS,
	exportPlan: EXPORT_PLAN,
	batch: {
		batchId: 'batch-1', memberId: 'member-1', presetId: 'preset-flac',
		target: { kind: 'project' }, mode: 'mix',
	},
});
const PLAN_SHA = fingerprintSoundscaperDeliveryPlanV1(PLAN).sha256;
const JOB_ID = '11'.repeat(24);
const CLAIM_ID = '22'.repeat(24);

test('browser composition preserves the session-only delivery queue', () => {
	assert.equal(createSoundscaperPersistentDeliveryControllerComposition({
		bridge: null,
	} as never), null);
});

test('persistent delivery labels and identifiers reject invisible format and separator characters', () => {
	assert.throws(() => createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: SETTINGS, exportPlan: EXPORT_PLAN,
		batch: {
			batchId: 'batch\u200b', memberId: 'member-1', presetId: 'preset-flac',
			target: { kind: 'project' }, mode: 'mix',
		},
	}), /batchId.*invalid/iu);
	assert.throws(() => validateSoundscaperPersistentDeliveryBatchMemberV1({
		memberId: 'member-1', label: 'FLAC\u2028master', presetId: 'preset-flac',
		target: { kind: 'region', id: 'region\u2029hidden' }, mode: 'mix', settings: SETTINGS,
	}), /label|target id|invalid/iu);
});

test('desktop composition starts the persistent worker and wakes it after queue resume', async () => {
	const fixture = compositionFixture({ entries: [] });
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	await composition.ready;
	assert.equal(composition.queue.persistent, true);
	const before = fixture.calls.list;
	await composition.queue.resume();
	assert.ok(fixture.calls.list > before, 'resuming wakes the renderer worker');
	await composition.dispose();
	assert.equal(fixture.calls.unsubscribe, 1);
});

test('an edited project cancels and releases its exact active claim', async () => {
	const fixture = compositionFixture({ entries: [queuedEntry()] });
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	await fixture.executing;
	fixture.project.revision += 1;
	fixture.publish();
	await fixture.released;
	assert.equal(fixture.calls.cancelExport, 1);
	assert.deepEqual(fixture.calls.releases, [CLAIM_ID]);
	assert.equal(fixture.calls.complete, 0);
	assert.equal(fixture.calls.openProjectBindings.at(-1), null,
		'the renderer clears main-owned open-generation authority when its project changes');
	await composition.dispose();
});

test('cancelling a running row aborts its ordinary export before main settles the job', async () => {
	const fixture = compositionFixture({ entries: [queuedEntry()] });
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	await fixture.executing;
	await composition.queue.cancel(JOB_ID);
	assert.equal(fixture.calls.cancelExport, 1);
	assert.deepEqual(fixture.calls.releases, [CLAIM_ID]);
	assert.deepEqual(fixture.calls.cancelJobs, [JOB_ID]);
	await composition.dispose();
});

test('a failed project-authority transition does not wedge later project changes', async () => {
	const fixture = compositionFixture({ entries: [] });
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	await composition.ready;
	fixture.failNextAuthorityClear();
	fixture.project.revision += 1;
	fixture.publish();
	await fixture.backgroundFailure;
	fixture.project.revision += 1;
	fixture.publish();
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.ok(fixture.calls.openProjectBindings.filter((projectId) => projectId === null).length >= 2,
		'a later project transition must retry clearing stale main authority');
	await composition.dispose();
});

test('workspace disposal clears authority after an in-flight startup binding settles', async () => {
	const fixture = compositionFixture({ entries: [], deferInitialAuthority: true });
	const composition = createSoundscaperPersistentDeliveryControllerComposition(fixture.runtime);
	assert.ok(composition);
	const disposal = composition.dispose();
	fixture.releaseInitialAuthority();
	await Promise.all([composition.ready, disposal]);
	assert.equal(fixture.calls.settledProjectBindings.at(-1), null,
		'startup must not restore main authority after workspace disposal clears it');
});

function compositionFixture(options: Readonly<{
	entries: readonly SoundscaperPersistentDeliverySummary[];
	deferInitialAuthority?: boolean;
}>) {
	let entries = [...options.entries];
	let listener: (() => void) | null = null;
	let rejectExecution: ((error: unknown) => void) | null = null;
	let signalExecuting: (() => void) | null = null;
	let signalReleased: (() => void) | null = null;
	let signalBackgroundFailure: (() => void) | null = null;
	let authorityClearFailure: Error | null = null;
	let releaseInitialAuthority: () => void = () => undefined;
	const executing = new Promise<void>((resolve) => { signalExecuting = resolve; });
	const released = new Promise<void>((resolve) => { signalReleased = resolve; });
	const backgroundFailure = new Promise<void>((resolve) => { signalBackgroundFailure = resolve; });
	const initialAuthority = options.deferInitialAuthority
		? new Promise<void>((resolve) => { releaseInitialAuthority = resolve; })
		: Promise.resolve();
	const project = { id: 'project-1', revision: 7, title: 'Album' };
	const projectGeneration = 1;
	const calls = {
		list: 0, cancelExport: 0, complete: 0, unsubscribe: 0,
		releases: [] as string[], cancelJobs: [] as string[],
		openProjectBindings: [] as Array<string | null>,
		settledProjectBindings: [] as Array<string | null>,
	};
	const bridge = {
		selectDestination: async () => ({ grantId: 'cd'.repeat(24) }),
		reauthorizeDestination: async ({ grantId }: { grantId: string }) => ({ grantId }),
		currentProjectIdentity: async ({ projectId }: { projectId: string | null }) => {
			calls.openProjectBindings.push(projectId);
			if (projectId === null && authorityClearFailure) {
				const failure = authorityClearFailure;
				authorityClearFailure = null;
				throw failure;
			}
			if (projectId !== null) await initialAuthority;
			calls.settledProjectBindings.push(projectId);
			return projectId === null ? null : PROJECT_IDENTITY;
		},
		enqueueBatch: async () => entries,
		list: async () => {
			calls.list += 1;
			return { entries, paused: false, nextCursor: null };
		},
		events: async () => ({ events: [], nextSequence: 0, hasMore: false }),
		pause: async () => undefined,
		resume: async () => undefined,
		reorder: async () => undefined,
		cancel: async ({ jobId }: { jobId: string }) => {
			calls.cancelJobs.push(jobId);
			entries = entries.map((entry) => entry.jobId === jobId
				? { ...entry, state: 'cancelled' as const } : entry);
		},
		retry: async () => undefined,
	};
	const workerTransport = {
		claimNext: async ({ jobId }: { jobId: string }) => {
			if (jobId !== JOB_ID) return null;
			entries = entries.map((entry) => ({ ...entry, state: 'running' as const }));
			return {
				jobId: JOB_ID, claimId: CLAIM_ID, plan: PLAN,
				progress: async () => undefined,
				beginWrite: async () => ({ writeId: '33'.repeat(24), chunkSize: 4 * 1024 * 1024 }),
				writeChunk: async () => ({ nextOffset: 0 }),
				patchFinalPrefix: async () => ({ byteLength: 0 }),
				finishWrite: async () => ({ byteLength: 0 }),
				abortWrite: async () => undefined,
				complete: async () => { calls.complete += 1; },
				fail: async () => undefined,
				release: async () => {
					calls.releases.push(CLAIM_ID);
					entries = entries.map((entry) => ({ ...entry, state: 'queued' as const }));
					signalReleased?.();
				},
			};
		},
	};
	return {
		calls,
		backgroundFailure,
		executing,
		failNextAuthorityClear: () => {
			authorityClearFailure = new Error('planned authority-clear failure');
		},
		project,
		publish: () => listener?.(),
		releaseInitialAuthority,
		released,
		runtime: {
			bridge,
			workerTransport,
			getProject: () => project,
			getSaveState: () => 'saved',
			captureProjectGeneration: () => Object.freeze({ generation: projectGeneration, projectId: project.id }),
			assertProjectGeneration: (token: unknown) => {
				const observed = token as Readonly<{ generation: number; projectId: string }>;
				if (observed.generation !== projectGeneration || observed.projectId !== project.id) {
					throw new Error('Project generation changed.');
				}
			},
			exportService: {
				persistentAudioDeliveryAvailable: () => true,
				whenPersistentAudioDeliveryAvailable: async () => undefined,
				derivePersistentAudioDeliveryPlan: async () => ({ settings: SETTINGS, exportPlan: EXPORT_PLAN }),
				executePersistentAudioDeliveryPlan: async () => {
					signalExecuting?.();
					return new Promise((_, reject) => { rejectExecution = reject; });
				},
			},
			deliveryReport: () => deliveryReport(),
			cancelExport: () => {
				calls.cancelExport += 1;
				rejectExecution?.(new DOMException('Project changed.', 'AbortError'));
			},
			publishDocumentSnapshot: () => listener?.(),
			onBackgroundError: () => { signalBackgroundFailure?.(); },
			subscribe: (next: () => void) => {
				listener = next;
				return () => { calls.unsubscribe += 1; listener = null; };
			},
		},
	};
}

function queuedEntry(): SoundscaperPersistentDeliverySummary {
	return Object.freeze({
		jobId: JOB_ID, label: 'FLAC', state: 'queued', attempt: 0, progress: null,
		lastFailureCode: null, projectIdentity: PROJECT_IDENTITY, planFingerprint: PLAN_SHA,
		destinationGrantId: 'cd'.repeat(24), batchId: 'batch-1', report: null, result: null,
		batchMember: {
			memberId: 'member-1', label: 'FLAC', presetId: 'preset-flac',
			target: { kind: 'project' as const }, mode: 'mix' as const, settings: SETTINGS,
		},
	});
}

function deliveryReport(): DeliveryReport {
	return Object.freeze({
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: {
			format: 'flac', container: 'flac', codec: 'flac', sampleRate: 48_000,
			channelCount: 2, lossless: true,
		},
		items: [Object.freeze({
			code: 'audio', severity: 'info' as const, disposition: 'preserved' as const,
			scope: Object.freeze({ kind: 'mix' }), data: Object.freeze({}),
		})],
		counts: { preserved: 1, converted: 0, missing: 0, omitted: 0 },
	});
}
