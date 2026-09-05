/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FramescaperCapturedVideoProxyRequest,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import type { VideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import type {
	CapturedVideoProxySchedulerDependencies,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-composition.ts';
import {
	capturedVideoProxySchedulerPolicy,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-state.ts';
import {
	createFramescaperCapturedVideoProxyScheduler,
	type FramescaperCapturedVideoProxyScheduler,
} from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	nextCapturedVideoProxyAttachmentProject,
} from '../src/framescaper/editor-captured-video-proxy-transition.ts';
import {
	reconcileFramescaperProjectFeatureRequirements,
} from '../src/framescaper/editor-project-feature-requirements.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const PROJECT_ID = 'framescaper-v20';
const SOURCE_ID = 'video-source';
const SESSION_ID = 'capture-session';
const DIGEST = '12'.repeat(32);
const OTHER_DIGEST = 'cd'.repeat(32);
const LOAD = `load:${PROJECT_ID}`;
const QUIESCE = `quiesce:${PROJECT_ID}`;

const CODEC = {
	schemaVersion: 1,
	profile: PROFILE,
	reconcileProjectRequirements: (project: unknown) => (
		reconcileFramescaperProjectFeatureRequirements(PROFILE, project)
	),
} as unknown as CapturedVideoProxySchedulerDependencies;

function proxyAttachment(proxyByte: string, timingByte: string): VideoProxyAttachmentV18 {
	const sha256 = proxyByte.repeat(32);
	const timingSha256 = timingByte.repeat(32);
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${sha256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256,
		originalSha256: DIGEST, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: sha256, byteLength: 112,
			frameCount: 10, timescale: 1_000, finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	} as unknown as VideoProxyAttachmentV18;
}

const UNATTACHED = createFramescaperProject(
	PROFILE, framescaperV20Options() as never,
) as unknown as Data;
const ATTACHMENT = proxyAttachment('34', '56');
/** The durable project a completed capture leaves behind: one attached video source. */
const ATTACHED = nextCapturedVideoProxyAttachmentProject(
	CODEC, UNATTACHED as never, SOURCE_ID, ATTACHMENT,
) as unknown as Data;
const INSTALLED_ATTACHMENT = (ATTACHED.sources as Data[])
	.find(({ id }) => id === SOURCE_ID)!.proxyAttachment as VideoProxyAttachmentV18;

interface SessionTab {
	readonly projectId: string;
	readonly readOnly: boolean;
	readonly history: Data;
}

interface HarnessOptions {
	readonly sequence?: readonly Data[];
	readonly load?: (projectId: string, signal?: AbortSignal) => Promise<unknown>;
	readonly tabs?: readonly SessionTab[];
	readonly activeProjectId?: string | null;
	readonly quiesce?: boolean;
	readonly releaseLease?: () => boolean;
	readonly releaseReservation?: () => boolean;
}

interface Harness {
	readonly schedule: FramescaperCapturedVideoProxyScheduler;
	readonly steps: string[];
	readonly updates: Data[];
	readonly signals: (AbortSignal | undefined)[];
}

function harness(options: HarnessOptions = {}): Harness {
	const steps: string[] = [];
	const updates: Data[] = [];
	const signals: (AbortSignal | undefined)[] = [];
	const sequence = options.sequence ?? [ATTACHED];
	const tabs = options.tabs ?? [];
	const token = {};
	let loads = 0;
	const dependencies = {
		schemaVersion: 1,
		profile: PROFILE,
		policy: capturedVideoProxySchedulerPolicy({}),
		port: { database: async () => null },
		opfs: {},
		store: {},
		candidateObserver: null,
		projectForRelationship: (project: unknown) => project,
		reconcileProjectRequirements: (project: unknown) => (
			reconcileFramescaperProjectFeatureRequirements(PROFILE, project)
		),
		loadAuthoritativeProject: (projectId: string, signal?: AbortSignal): Promise<unknown> => {
			steps.push(`load:${projectId}`);
			signals.push(signal);
			if (options.load) return options.load(projectId, signal);
			return Promise.resolve(sequence[Math.min(loads++, sequence.length - 1)]);
		},
		claimCleanup: {
			cleanupOperation: async () => {
				steps.push('cleanup');
				return { status: 'settled' as const };
			},
		},
		synchronizeActiveProject: (update: Data) => { steps.push('sync'); updates.push(update); },
		quiesceProjectSaves: options.quiesce === false ? null : (projectId: string) => {
			steps.push(`quiesce:${projectId}`);
			return {
				release: () => {
					steps.push('lease-release');
					return (options.releaseLease ?? (() => true))();
				},
			};
		},
		session: {
			getSnapshot: () => ({ activeProjectId: options.activeProjectId ?? null, tabs }),
			captureProjectHistory: (projectId: string) => ({
				token,
				history: tabs.find((tab) => tab.projectId === projectId)?.history ?? {},
			}),
			assertProjectHistoryToken: () => undefined,
			beginProjectActivation: () => ({
				token: {},
				release: () => {
					steps.push('reservation-release');
					return (options.releaseReservation ?? (() => true))();
				},
			}),
			installCommittedProjectHistory: (_projectId: string, history: unknown) => {
				steps.push('install');
				return { history };
			},
		},
	};
	return {
		schedule: createFramescaperCapturedVideoProxyScheduler(
			dependencies as unknown as CapturedVideoProxySchedulerDependencies,
		),
		steps,
		updates,
		signals,
	};
}

function request(
	overrides: Partial<FramescaperCapturedVideoProxyRequest> = {},
): FramescaperCapturedVideoProxyRequest {
	return {
		projectId: PROJECT_ID,
		sessionId: SESSION_ID,
		sourceId: SOURCE_ID,
		expectedProjectRevision: 1,
		expectedContentSha256: DIGEST,
		...overrides,
	};
}

function openTab(present: Data, readOnly = false): SessionTab {
	return { projectId: PROJECT_ID, readOnly, history: { limit: 20, present, undoStack: [], redoStack: [] } };
}

/** Capture the settlement without leaving an unhandled rejection while a gate is open. */
function settled(promise: Promise<void>): Promise<unknown> {
	return promise.then(() => null, (error: unknown) => error);
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((value) => { resolve = value; });
	return { promise, resolve };
}

function tick(): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

test('an already attached source reconciles the landed project instead of generating a second proxy', async () => {
	const { schedule, steps, signals } = harness();

	await schedule(request());

	assert.deepEqual(steps, [LOAD, QUIESCE, LOAD, 'reservation-release', 'lease-release']);
	assert.ok(signals[0] instanceof AbortSignal, 'the base load carries the scheduler lifetime signal');
	assert.equal(signals[0]?.aborted, false);
	await schedule.dispose();
});

test('the landed reconciliation of an open active project synchronizes it without rewriting its history', async () => {
	const { schedule, steps, updates } = harness({
		tabs: [openTab(ATTACHED)],
		activeProjectId: PROJECT_ID,
	});

	await schedule(request());

	assert.deepEqual(steps, [LOAD, QUIESCE, LOAD, 'sync', 'reservation-release', 'lease-release']);
	assert.equal(updates.length, 1);
	assert.equal(updates[0]!.projectId, PROJECT_ID);
	assert.equal((updates[0]!.project as Data).revision, ATTACHED.revision);
	await schedule.dispose();
});

test('an open project that is not the active one is reconciled without any active update', async () => {
	const { schedule, steps, updates } = harness({
		tabs: [openTab(ATTACHED)],
		activeProjectId: 'another-project',
	});

	await schedule(request());

	assert.deepEqual(updates, []);
	assert.ok(!steps.includes('sync'));
	assert.ok(!steps.includes('install'));
	await schedule.dispose();
});

test('a read-only open project cancels the landed reconciliation and still releases its save lease', async () => {
	const { schedule, steps } = harness({ tabs: [openTab(ATTACHED, true)] });

	await assert.rejects(
		() => schedule(request()),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /origin became read-only/u);
			return true;
		},
	);

	assert.deepEqual(steps, [LOAD, QUIESCE, LOAD, 'lease-release']);
	await schedule.dispose();
});

test('an open project that diverged from the durable target refuses to be reconciled over', async () => {
	const { schedule, steps } = harness({ tabs: [openTab(UNATTACHED)] });

	await assert.rejects(
		() => schedule(request()),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /no longer matches its durable predecessor or target/u);
			return true;
		},
	);

	assert.ok(!steps.includes('install'), 'a diverged open history is never overwritten');
	assert.deepEqual(steps, [LOAD, QUIESCE, LOAD, 'lease-release']);
	await schedule.dispose();
});

test('a project that changes while the queued saves drain cancels the landed reconciliation', async () => {
	const { schedule, steps } = harness({ sequence: [ATTACHED, UNATTACHED] });

	await assert.rejects(
		() => schedule(request()),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /changed while queued saves drained/u);
			return true;
		},
	);

	assert.deepEqual(steps, [LOAD, QUIESCE, LOAD, 'lease-release']);
	await schedule.dispose();
});

test('a runtime without a save-quiescing seam reconciles the landed project with no lease at all', async () => {
	const { schedule, steps } = harness({ quiesce: false });

	await schedule(request());

	assert.deepEqual(steps, [LOAD, LOAD, 'reservation-release']);
	await schedule.dispose();
});

test('a failing save-lease release surfaces even though the reconciliation itself committed', async () => {
	const failure = new Error('the save lease refused to release');
	const { schedule, steps } = harness({
		tabs: [openTab(ATTACHED)],
		activeProjectId: PROJECT_ID,
		releaseLease: () => { throw failure; },
	});

	const error = await settled(schedule(request()));

	assert.equal(error, failure, 'a lone finalizer failure is reported as itself, not wrapped');
	assert.ok(steps.includes('sync'), 'the landed project was still synchronized before the finalizer failed');
	await schedule.dispose();
});

test('a cancelled reconciliation and a failing finalizer are reported together as one aggregate', async () => {
	const failure = new Error('the save lease refused to release');
	const { schedule } = harness({
		tabs: [openTab(ATTACHED, true)],
		releaseLease: () => { throw failure; },
	});

	const error = await settled(schedule(request())) as AggregateError;

	assert.ok(error instanceof AggregateError);
	assert.match(error.message, /work and finalizers failed/u);
	assert.equal(error.errors.length, 2);
	assert.equal((error.errors[0] as Error).name, 'AbortError');
	assert.equal(error.errors[1], failure);
	assert.equal(error.cause, error.errors[0]);
	await schedule.dispose();
});

test('two failing finalizers are aggregated on their own when the work itself succeeded', async () => {
	const reservationFailure = new Error('the reservation refused to release');
	const leaseFailure = new Error('the save lease refused to release');
	const { schedule } = harness({
		releaseReservation: () => { throw reservationFailure; },
		releaseLease: () => { throw leaseFailure; },
	});

	const error = await settled(schedule(request())) as AggregateError;

	assert.ok(error instanceof AggregateError);
	assert.match(error.message, /Captured proxy finalizers failed/u);
	assert.deepEqual(error.errors, [reservationFailure, leaseFailure]);
	assert.equal(error.cause, undefined, 'no primary failure means the aggregate carries no cause');
	await schedule.dispose();
});

test('a replacement whose expected attachment no longer matches is refused before any save is quiesced', async () => {
	const { schedule, steps } = harness();

	await assert.rejects(
		() => schedule(request({ expectedProxyAttachment: proxyAttachment('78', '9a') })),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /replacement attachment changed before generation/u);
			return true;
		},
	);

	assert.deepEqual(steps, [LOAD], 'the refusal never reaches the save-quiescing seam');
	await schedule.dispose();
});

test('a landed reconciliation records the lineage that admits a later replacement at the same revision', async () => {
	const { schedule } = harness();
	await schedule(request({ expectedProjectRevision: 99 }));

	// The lineage, not the durable revision, is what admits this replacement.
	await assert.rejects(
		() => schedule(request({
			expectedProjectRevision: 99,
			expectedProxyAttachment: INSTALLED_ATTACHMENT,
		})),
		(error: Error) => {
			assert.equal(error.name, 'Error');
			assert.match(error.message, /cannot generate captured video proxies/u);
			return true;
		},
	);
	await assert.rejects(
		() => schedule(request({
			expectedProjectRevision: 98,
			expectedProxyAttachment: INSTALLED_ATTACHMENT,
		})),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /origin revision is no longer current/u);
			return true;
		},
	);
	await schedule.dispose();
});

test('a request that never staged a body is neither cleaned up nor retried automatically', async () => {
	const { schedule, steps } = harness();

	await assert.rejects(
		() => schedule(request({ expectedContentSha256: OTHER_DIGEST })),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /source digest changed before proxy generation/u);
			return true;
		},
	);
	await tick();

	assert.deepEqual(steps, [LOAD], 'no landed transition evidence means no automatic second attempt');
	await schedule.dispose();
});

test('queued requests run one at a time and a failure never wedges the ones behind it', async () => {
	const gate = deferred();
	const order: string[] = [];
	let calls = 0;
	const { schedule } = harness({
		load: async () => {
			calls += 1;
			const call = calls;
			order.push(`start-${String(call)}`);
			if (call === 1) await gate.promise;
			order.push(`end-${String(call)}`);
			return ATTACHED;
		},
	});

	const first = settled(schedule(request({ expectedContentSha256: OTHER_DIGEST })));
	const second = settled(schedule(request({
		sessionId: 'queued-session', expectedContentSha256: OTHER_DIGEST,
	})));
	await tick();
	assert.deepEqual(order, ['start-1'], 'the second request waits behind the first');

	gate.resolve();
	const errors = await Promise.all([first, second]) as Error[];

	assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
	for (const error of errors) assert.match(error.message, /source digest changed before proxy generation/u);
	await schedule.dispose();
});

test('disposal cancels the request in flight and the one still queued behind it', async () => {
	const gate = deferred();
	let calls = 0;
	const { schedule } = harness({
		load: async () => { calls += 1; await gate.promise; return ATTACHED; },
	});

	const running = settled(schedule(request()));
	const queued = settled(schedule(request({ sessionId: 'queued-session' })));
	await tick();
	const disposal = schedule.dispose();
	gate.resolve();
	const [runningError, queuedError] = await Promise.all([running, queued]) as Error[];
	await disposal;

	assert.equal(calls, 1, 'the queued request is cancelled at the head of the queue, before it loads');
	for (const error of [runningError, queuedError]) {
		assert.equal(error.name, 'AbortError');
		assert.match(error.message, /scheduler was disposed/u);
	}
});
