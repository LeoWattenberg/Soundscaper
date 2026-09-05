/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import type {
	FramescaperCapturedVideoProxyRequest,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import type {
	VideoProxyCandidateRuntime,
} from '../src/common/editor/controller/video-proxy-candidate-composition.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	assertVideoProxyCandidateObserver,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import type { VideoTimingProbePort } from '../src/common/editor/video-timing-probe.ts';
import {
	capturedVideoProxySchedulerDependencies,
	type FramescaperCapturedVideoProxyRuntimeComposition,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-composition.ts';
import {
	createFramescaperCapturedVideoProxyScheduler,
	createFramescaperExistingVideoProxyScheduler,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-runtime.ts';
import {
	createFramescaperEditorProjectEnvironment,
	type FramescaperEditorProjectEnvironment,
} from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectStoreAuthority } from '../src/framescaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;
type Environment = Readonly<FramescaperEditorProjectEnvironment>;
type Composition = FramescaperCapturedVideoProxyRuntimeComposition;
type Scheduler = ReturnType<typeof createFramescaperCapturedVideoProxyScheduler>;

const NEVER_RUN = 'The captured proxy composition tests never encode or probe.';
const SOURCE_ID = 'captured-video-source';
const DIGEST = 'ab'.repeat(32);
const SESSION_METHODS = [
	'getSnapshot', 'captureProjectHistory', 'assertProjectHistoryToken',
	'beginProjectActivation', 'installCommittedProjectHistory',
] as const;

/** The composition demands the WeakSet-registered environment, so one real store is shared. */
let opened: Promise<Environment> | null = null;

function environment(): Promise<Environment> {
	const value = opened ?? createFramescaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			} as unknown as StorageManager,
		},
	});
	opened = value;
	return value;
}

after(async () => {
	if (opened) await (await opened).close();
});

function session(): Data {
	return {
		getSnapshot: () => ({ activeProjectId: null, tabs: [] }),
		captureProjectHistory: () => ({ token: {}, history: {} }),
		assertProjectHistoryToken: () => undefined,
		beginProjectActivation: () => ({ token: {}, release: () => true }),
		installCommittedProjectHistory: () => undefined,
	};
}

function composition(overrides: Partial<Composition> = {}): Composition {
	return { runtime: null, ...overrides };
}

/** A runtime that can encode is only ever asked to exist here, never to run. */
function generatingRuntime(): VideoProxyCandidateRuntime {
	return { runProxyMediaOperation: () => Promise.reject(new Error(NEVER_RUN)) };
}

function timingProbe(): VideoTimingProbePort {
	return { id: 'helper', probe: () => Promise.reject(new Error(NEVER_RUN)) };
}

/** A bin clip keeps the source reachable, so durable retention cannot compact it away. */
function videoProject(id: string): Data {
	return createFramescaperProject(PROFILE, {
		id, title: id, now: '2026-09-05T09:00:00.000Z',
		sources: [createVideoSource({
			id: SOURCE_ID, name: 'capture.mp4', storageKey: SOURCE_ID, mimeType: 'video/mp4',
			contentSha256: DIGEST, sampleFrameCount: 48_000, sourceFrameCount: 30,
			frameRate: { num: 30, den: 1 }, width: 640, height: 360, videoCodec: 'h264',
		})],
		projectBin: { clips: [{
			kind: 'video', id: 'capture-bin-clip', binItemId: 'capture-bin-clip',
			sourceId: SOURCE_ID, sequenceId: 'main-sequence', retimeMap: null,
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30,
		}] },
	}) as unknown as Data;
}

async function storedProject(id: string): Promise<Data> {
	const value = await environment();
	await value.createProjectIfAbsent(videoProject(id) as never);
	const loaded = await value.store.loadProject(id) as Data | null;
	assert.ok(loaded, 'the durable store must answer the project the product just created');
	return loaded;
}

function request(overrides: Partial<FramescaperCapturedVideoProxyRequest> & Readonly<{
	readonly projectId: string;
	readonly expectedProjectRevision: number;
}>): FramescaperCapturedVideoProxyRequest {
	return { sessionId: 'capture-session', sourceId: SOURCE_ID, expectedContentSha256: DIGEST, ...overrides };
}

async function schedule(scheduler: Scheduler, value: FramescaperCapturedVideoProxyRequest): Promise<unknown> {
	try {
		return await scheduler(value);
	} finally {
		await scheduler.dispose();
	}
}

test('an environment the product factory never minted is refused before the session is read', async () => {
	const real = await environment();

	for (const candidate of [null, undefined, {}, [], 'environment', 42]) {
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(candidate, session(), composition()),
			/product-created Framescaper environment/u,
		);
	}
	// A structural copy carries every field and none of the registered identity,
	// and its refusal outranks the empty session handed in beside it.
	assert.throws(
		() => capturedVideoProxySchedulerDependencies({ ...real }, {}, composition()),
		/product-created Framescaper environment/u,
	);
});

test('a session that is not an object is refused as the missing capture session', async () => {
	const real = await environment();

	for (const candidate of [null, undefined, 'session', 7]) {
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, candidate, composition()),
			/Captured proxy scheduling requires its session\./u,
		);
	}
});

test('a session missing any one reconciliation method is refused by that method name', async () => {
	const real = await environment();

	for (const method of SESSION_METHODS) {
		const partial = session();
		delete partial[method];

		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, partial, composition()),
			new RegExp(`requires session\\.${method}\\.`, 'u'),
			`session.${method} must be demanded by name`,
		);
		partial[method] = 'not a function';
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, partial, composition()),
			new RegExp(`requires session\\.${method}\\.`, 'u'),
		);
	}
});

test('a composition that is not an object is refused before any candidate is observed', async () => {
	const real = await environment();

	for (const candidate of ['composition', 42, true]) {
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, session(), candidate as never),
			/Captured proxy runtime composition is required\./u,
		);
	}
	// A null composition is read for its optional seams first, so it fails as a
	// plain property read rather than with the composition's own message.
	assert.throws(
		() => capturedVideoProxySchedulerDependencies(real, session(), null as never),
		TypeError,
	);
});

test('a runtime without the ffmpeg proxy operation composes no candidate observer at all', async () => {
	const real = await environment();

	const runtimes: readonly (VideoProxyCandidateRuntime | null | undefined)[] = [
		null, undefined, {}, { probeVideoTiming: timingProbe().probe },
	];

	for (const runtime of runtimes) {
		const dependencies = capturedVideoProxySchedulerDependencies(
			real, session(), composition({ runtime }),
		);

		assert.equal(dependencies.candidateObserver, null);
	}
});

test('a runtime that can encode composes an authenticated candidate observer', async () => {
	const real = await environment();

	const dependencies = capturedVideoProxySchedulerDependencies(
		real, session(), composition({ runtime: generatingRuntime() }),
	);

	const observer = dependencies.candidateObserver;
	assert.ok(observer);
	assert.equal(observer.kind, 'video-proxy-candidate-observer');
	assert.equal(observer.version, 1);
	assert.equal(assertVideoProxyCandidateObserver(observer), observer);
});

test('an explicit candidate observer replaces whatever the runtime would have composed', async () => {
	const real = await environment();
	const composed = capturedVideoProxySchedulerDependencies(
		real, session(), composition({ runtime: generatingRuntime() }),
	).candidateObserver;
	assert.ok(composed);

	// The runtime cannot generate, so only the injected seam can supply an observer.
	const dependencies = capturedVideoProxySchedulerDependencies(
		real, session(), composition({ runtime: null, candidateObserver: composed }),
	);

	assert.equal(dependencies.candidateObserver, composed);
});

test('a candidate observer this authority never minted is refused as unauthenticated', async () => {
	const real = await environment();

	for (const candidate of [{ kind: 'video-proxy-candidate-observer', version: 1 }, {}, 'observer']) {
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, session(), composition({
				runtime: generatingRuntime(), candidateObserver: candidate as never,
			})),
			/authenticated video proxy candidate observer/u,
		);
	}
});

test('an unusable helper timing probe or candidate bound is refused while composing', async () => {
	const real = await environment();

	assert.throws(
		() => capturedVideoProxySchedulerDependencies(real, session(), composition({
			runtime: generatingRuntime(), helperTimingProbe: { id: 'helper' } as never,
		})),
		TypeError,
	);
	assert.throws(
		() => capturedVideoProxySchedulerDependencies(real, session(), composition({
			runtime: generatingRuntime(), maximumBytes: 0,
		})),
		/positive safe integer/u,
	);
	assert.throws(
		() => capturedVideoProxySchedulerDependencies(real, session(), composition({
			runtime: generatingRuntime(), maximumBytes: 512 * 1024 * 1024 + 1,
		})),
		/cannot raise its hard limit/u,
	);
	assert.ok(capturedVideoProxySchedulerDependencies(real, session(), composition({
		runtime: generatingRuntime(), helperTimingProbe: timingProbe(), maximumBytes: 1024,
	})).candidateObserver);
});

test('the composed policy carries the captured proxy defaults as frozen bounds', async () => {
	const real = await environment();

	const { policy } = capturedVideoProxySchedulerDependencies(real, session(), composition());

	assert.deepEqual({ ...policy }, {
		maximumLineageEntries: 64, maximumLandedEntries: 16, maximumReconciliationAttempts: 3,
	});
	assert.ok(Object.isFrozen(policy));
});

test('the composed policy takes its bounds from the composition and refuses one out of range', async () => {
	const real = await environment();

	const { policy } = capturedVideoProxySchedulerDependencies(real, session(), composition({
		maximumLineageEntries: 256, maximumLandedEntries: 1, maximumReconciliationAttempts: 8,
	}));

	assert.equal(policy.maximumLineageEntries, 256);
	assert.equal(policy.maximumLandedEntries, 1);
	assert.equal(policy.maximumReconciliationAttempts, 8);
	for (const [invalid, name] of [
		[composition({ maximumLineageEntries: 257 }), 'lineage capacity'],
		[composition({ maximumLandedEntries: 0 }), 'landed capacity'],
		[composition({ maximumReconciliationAttempts: 1.5 }), 'reconciliation attempts'],
	] as const) {
		assert.throws(
			() => capturedVideoProxySchedulerDependencies(real, session(), invalid),
			new RegExp(`captured proxy ${name} is invalid`, 'u'),
		);
	}
});

test('a browser environment composes its own store, port and cleanup without a desktop seam', async () => {
	const real = await environment();
	const authority = framescaperProjectStoreAuthority(real.runtime.profile, real.store);

	const dependencies = capturedVideoProxySchedulerDependencies(real, session(), composition());

	assert.equal(dependencies.schemaVersion, 1);
	assert.equal(dependencies.profile, real.runtime.profile);
	assert.equal(dependencies.store, real.store as unknown);
	assert.equal(dependencies.port, authority.port);
	assert.equal(dependencies.opfs, authority.opfs);
	assert.equal(dependencies.claimCleanup, real.claimCleanup);
	// Without a desktop project library the local store is the only authority,
	// so the publication seam must be absent rather than present and undefined.
	assert.equal('publishDesktopProject' in dependencies, false);
});

test('the optional active-project and save-quiescing seams default to null and otherwise pass through', async () => {
	const real = await environment();
	const synchronizeActiveProject = () => undefined;
	const quiesceProjectSaves = () => ({ release: () => true });

	const bare = capturedVideoProxySchedulerDependencies(real, session(), composition());
	const wired = capturedVideoProxySchedulerDependencies(real, session(), composition({
		synchronizeActiveProject, quiesceProjectSaves,
	}));

	assert.equal(bare.synchronizeActiveProject, null);
	assert.equal(bare.quiesceProjectSaves, null);
	assert.equal(wired.synchronizeActiveProject, synchronizeActiveProject);
	assert.equal(wired.quiesceProjectSaves, quiesceProjectSaves);
});

test('the composed project projections validate what they are handed against this family', async () => {
	const real = await environment();
	const dependencies = capturedVideoProxySchedulerDependencies(real, session(), composition());
	const project = videoProject('composed-projection-project');

	const relationship = dependencies.projectForRelationship(project) as Data;
	const requirements = dependencies.reconcileProjectRequirements(project) as Data;

	assert.deepEqual(
		(relationship.sources as readonly Data[]).map((source) => source.id),
		[SOURCE_ID],
	);
	assert.ok(Array.isArray(requirements.requirements));
	assert.equal(typeof requirements.schemaVersion, 'number');
	for (const candidate of [null, {}, { schemaFamily: 'soundscaper', schemaVersion: 1 }]) {
		assert.throws(() => dependencies.projectForRelationship(candidate), Error);
		assert.throws(() => dependencies.reconcileProjectRequirements(candidate), Error);
	}
});

test('the authoritative loader answers the durable project and null for one never created', async () => {
	const real = await environment();
	const dependencies = capturedVideoProxySchedulerDependencies(real, session(), composition());
	const stored = await storedProject('authoritative-load-project');

	const loaded = await dependencies.loadAuthoritativeProject('authoritative-load-project') as Data;

	assert.equal(loaded.id, 'authoritative-load-project');
	assert.equal(loaded.revision, stored.revision);
	assert.equal(await dependencies.loadAuthoritativeProject('project-never-created'), null);
});

test('the authoritative loader forwards its abort signal to the durable store', async () => {
	const real = await environment();
	const dependencies = capturedVideoProxySchedulerDependencies(real, session(), composition());
	const reason = new Error('the caller cancelled the captured proxy load');

	await assert.rejects(
		() => dependencies.loadAuthoritativeProject('authoritative-load-project', AbortSignal.abort(reason)),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('the captured scheduler factory refuses an environment the product never minted', async () => {
	const real = await environment();

	assert.throws(
		() => createFramescaperCapturedVideoProxyScheduler(
			{ ...real } as Environment, session(), composition(),
		),
		/product-created Framescaper environment/u,
	);
	const scheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition());

	assert.equal(typeof scheduler, 'function');
	await scheduler.dispose();
});

test('the existing-proxy factory refuses its composition before it looks at the environment', () => {
	const candidate = new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/mp4' });

	for (const value of [null, undefined, 'composition', 5]) {
		assert.throws(
			() => createFramescaperExistingVideoProxyScheduler(
				{} as Environment, session(), value as never, candidate,
			),
			/Existing Framescaper proxy attachment requires its runtime composition\./u,
		);
	}
});

test('an existing proxy candidate must be a non-empty blob of canonical video bytes', async () => {
	const real = await environment();

	assert.throws(
		() => createFramescaperExistingVideoProxyScheduler(
			real, session(), composition(), new Blob([], { type: 'video/mp4' }),
		),
		/existing video proxy cannot be empty/u,
	);
	assert.throws(
		() => createFramescaperExistingVideoProxyScheduler(
			real, session(), composition(),
			new Blob([Uint8Array.of(9)], { type: 'application/octet-stream' }),
		),
		/canonical video MIME type/u,
	);
	assert.throws(
		() => createFramescaperExistingVideoProxyScheduler(
			real, session(), composition(), 'not-a-blob' as never,
		),
		TypeError,
	);
});

test('the existing-proxy factory installs its own observer over the composed one', async () => {
	const real = await environment();
	const rejected = composition({ runtime: null, candidateObserver: { kind: 'forged' } as never });

	// The same forged observer is fatal to the captured factory, so accepting it
	// here proves the existing-candidate observer replaced it outright.
	assert.throws(
		() => createFramescaperCapturedVideoProxyScheduler(real, session(), rejected),
		/authenticated video proxy candidate observer/u,
	);
	const scheduler = createFramescaperExistingVideoProxyScheduler(
		real, session(), rejected, new Blob([Uint8Array.of(4, 5, 6)], { type: 'video/mp4' }),
	);

	assert.equal(typeof scheduler, 'function');
	await scheduler.dispose();
});

test('a scheduled request reads its base project through the composed durable store', async () => {
	const real = await environment();
	const scheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition());

	await assert.rejects(
		() => schedule(scheduler, request({
			projectId: 'project-never-created', expectedProjectRevision: 0,
		})),
		/project schema identity requires an object/u,
	);
});

test('a scheduled request for a source the project does not carry is refused by reference', async () => {
	const real = await environment();
	const stored = await storedProject('missing-source-project');
	const scheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition());

	await assert.rejects(
		() => schedule(scheduler, request({
			projectId: 'missing-source-project',
			expectedProjectRevision: Number(stored.revision),
			sourceId: 'no-such-source',
		})),
		(error: unknown) => {
			assert.ok(error instanceof ReferenceError);
			assert.match(error.message, /no-such-source is missing or ambiguous/u);
			return true;
		},
	);
});

test('a scheduled request whose digest or revision is stale is cancelled before generation', async () => {
	const real = await environment();
	const stored = await storedProject('stale-request-project');
	const revision = Number(stored.revision);

	const digestScheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition());
	await assert.rejects(
		() => schedule(digestScheduler, request({
			projectId: 'stale-request-project',
			expectedProjectRevision: revision,
			expectedContentSha256: 'cd'.repeat(32),
		})),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /source digest changed before proxy generation/u);
			return true;
		},
	);

	const revisionScheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition());
	await assert.rejects(
		() => schedule(revisionScheduler, request({
			projectId: 'stale-request-project', expectedProjectRevision: revision + 1,
		})),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /origin revision is no longer current/u);
			return true;
		},
	);
});

test('an admitted request on a runtime that cannot encode is refused as ungeneratable', async () => {
	const real = await environment();
	const stored = await storedProject('ungeneratable-project');
	const scheduler = createFramescaperCapturedVideoProxyScheduler(real, session(), composition({
		runtime: {},
	}));

	await assert.rejects(
		() => schedule(scheduler, request({
			projectId: 'ungeneratable-project', expectedProjectRevision: Number(stored.revision),
		})),
		(error: Error) => {
			assert.equal(error.name, 'Error');
			assert.match(error.message, /cannot generate captured video proxies/u);
			return true;
		},
	);
});
