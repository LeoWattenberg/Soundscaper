/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperCaptureProxyActiveProjectSynchronizer,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../src/common/editor/video-source-timing-views.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV18,
	createFramescaperCapturedVideoProxySchedulerV19,
} from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import {
	resolveFramescaperVideoProxyPreviewV18,
	type FramescaperVideoProxyPreviewPortsV18,
} from '../src/framescaper/editor-video-proxy-preview-v18.ts';
import type {
	FramescaperVideoProxyBodyRequestV18,
	FramescaperVideoProxyOriginalRequestV18,
} from '../src/framescaper/editor-video-proxy-reattestation-contract-v18.ts';
import { acquireFramescaperVideoProxyAttachmentBudgetV18 } from '../src/framescaper/editor-video-proxy-attachment-capacity-v18.ts';
import {
	FramescaperDesktopV10MainFixture,
} from './helpers/framescaper-desktop-v10-store-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import {
	capturedProxyRequest as request,
	capturedProxyStorageInventory,
	capturedVideoSource as videoSource,
	createCapturedProxyFixture as createFixture,
	failCapturedProxyFirstBodyPublicationReread,
	nextCapturedProxyOrdinaryRevision as nextOrdinaryRevision,
	persistentStorage,
	writeCapturedProxyOrdinaryBody,
	type CapturedProxyFixture as Fixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';
import {
	ORIGINAL_SOURCE_ID,
	deferred,
	exactProbeResult,
} from './helpers/video-proxy-relationship-fixtures.ts';

for (const schemaVersion of [18, 19, 20, 27, 31] as const) {
	test(`captured video proxy scheduling commits exact V${String(schemaVersion)} while another project stays active`, async (context) => {
		const fixture = await createFixture(context, schemaVersion);

		await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));

		const committed = await fixture.controllerStore.loadProject(String(fixture.origin.id));
		assert.ok(committed);
		const source = videoSource(committed, ORIGINAL_SOURCE_ID);
		assert.ok(source.proxyAttachment);
		assert.equal(source.proxyAttachment.originalSha256, fixture.originalSha256);
		assert.equal(Number((committed as Record<string, unknown>).revision), Number(fixture.origin.revision) + 1);
		assert.equal(fixture.session.getSnapshot().activeProjectId, fixture.active.id);
		const originTab = fixture.session.getSnapshot().tabs.find(
			({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
		);
		assert.ok(originTab);
		assert.equal((originTab.history.present as Record<string, unknown>).revision, committed.revision);
		assert.equal(originTab.readOnly, false);
		assert.equal(originTab.dirty, false);
		const proxyMetadata = await fixture.environment.store.getMediaAssetMetadata(source.proxyAttachment.storageKey);
		const timingMetadata = await fixture.environment.store.getMediaAssetMetadata(
			source.proxyAttachment.timingAsset.storageKey,
		);
		assert.equal((proxyMetadata as Record<string, unknown>).kind, 'video-proxy');
		assert.equal((timingMetadata as Record<string, unknown>).kind, 'video-timing');
	});

	test(`captured proxy scheduling attaches both V${String(schemaVersion)} videos in its owned revision chain`, async (context) => {
		const fixture = await createFixture(context, schemaVersion, true);

		await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
		await fixture.schedule(request(fixture.origin, 'second-video', fixture.originalSha256));

		const committed = await fixture.controllerStore.loadProject(String(fixture.origin.id));
		assert.ok(committed);
		assert.ok(videoSource(committed, ORIGINAL_SOURCE_ID).proxyAttachment);
		assert.ok(videoSource(committed, 'second-video').proxyAttachment);
		assert.equal(Number(committed.revision), Number(fixture.origin.revision) + 2);
		assert.equal(fixture.session.getSnapshot().activeProjectId, fixture.active.id);
	});
}

test('a source/project race rejects proxy work without mutating the newer canonical V19 project', async (context) => {
	const gate = deferred<void>();
	const fixture = await createFixture(context, 19, false, gate);
	const pending = fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	while (fixture.relationship.counters.generatorCalls === 0) {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	const newer = nextOrdinaryRevision(fixture.environment, fixture.origin, 'Changed during proxy generation');
	await fixture.environment.store.saveProject(newer);
	gate.resolve();

	await assert.rejects(pending, /changed during generation|no longer current|AbortError/iu);

	const current = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(current);
	assert.equal(current.title, 'Changed during proxy generation');
	assert.equal(videoSource(current, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.equal(fixture.session.getSnapshot().activeProjectId, fixture.active.id);
});

test('a distinct-store desktop V18 refusal preserves its canonical local predecessor', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	const fixture = await createFixture(context, 18, false, undefined, main);
	assert.notEqual(fixture.environment.store, fixture.controllerStore);
	main.beginFailure = new Error('planned main proxy refusal');

	for (let attempt = 0; attempt < 2; attempt += 1) {
		await assert.rejects(
			fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
			/planned main proxy refusal/u,
		);
		const planned = videoSource(main.lastBegin?.project, ORIGINAL_SOURCE_ID).proxyAttachment;
		assert.ok(planned);
		assert.equal(await fixture.environment.store.getMediaAssetMetadata(planned.storageKey), null);
		assert.equal(await fixture.environment.store.getMediaAssetMetadata(planned.timingAsset.storageKey), null);
		assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
			bodyKeys: [], claimKeys: [], tombstoneKeys: [],
		});
	}

	const authoritative = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	const local = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(authoritative);
	assert.ok(local);
	assert.equal(Number(authoritative.revision), Number(fixture.origin.revision));
	assert.equal(Number(local.revision), Number(fixture.origin.revision));
	assert.equal(videoSource(authoritative, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.equal(videoSource(local, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.equal(fixture.session.getSnapshot().activeProjectId, fixture.active.id);
});

test('desktop main-begin failure leaves the canonical shadow reopenable after restart', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const main = new FramescaperDesktopV10MainFixture();
	const fixture = await createFixture(context, 18, false, undefined, main, indexedDB);
	main.beginFailure = new Error('planned crash before main publication admission');

	await assert.rejects(
		fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/planned crash before main publication admission/u,
	);
	await fixture.environment.close();

	const reopened = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: { indexedDB, preferOpfs: false, storageManager: persistentStorage() },
	});
	context.after(() => reopened.close());
	const [authoritative, local] = await Promise.all([
		reopened.controllerStore.loadProject(String(fixture.origin.id)),
		reopened.store.loadProject(String(fixture.origin.id)),
	]);
	assert.ok(authoritative);
	assert.ok(local);
	assert.equal(Number(authoritative.revision), Number(fixture.origin.revision));
	assert.equal(Number(local.revision), Number(fixture.origin.revision));
	assert.equal(videoSource(authoritative, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.equal(videoSource(local, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.deepEqual(await capturedProxyStorageInventory(reopened), {
		bodyKeys: [], claimKeys: [], tombstoneKeys: [],
	});
});

test('desktop body upload holds no session reservation for unrelated edits or switches', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createFixture(context, 18, false, undefined, main);
	const uploadEntered = deferred<void>();
	const releaseUpload = deferred<void>();
	main.afterUpload = async () => {
		uploadEntered.resolve();
		await releaseUpload.promise;
	};
	const pending = fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	await uploadEntered.promise;
	const deferredShadow = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(deferredShadow);
	assert.equal(Number(deferredShadow.revision), Number(fixture.origin.revision));
	assert.equal(videoSource(deferredShadow, ORIGINAL_SOURCE_ID).proxyAttachment, null,
		'the main upload never exposes a tentative local target');

	const editedActive = nextOrdinaryRevision(fixture.environment, fixture.active, 'Edited during proxy upload');
	fixture.session.updateProject(String(fixture.active.id), editedActive);
	assert.equal(fixture.session.switchProject(String(fixture.origin.id)), true);
	assert.equal(fixture.session.switchProject(String(fixture.active.id)), true);
	releaseUpload.resolve();
	await pending;

	const activeTab = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.active.id,
	);
	assert.equal((activeTab?.history.present as Record<string, unknown>).title, 'Edited during proxy upload');
	assert.equal(fixture.session.getSnapshot().activeProjectId, fixture.active.id);
});

test('a second-body failure reclaims a newly created first body and claim', async (context) => {
	const fixture = await createFixture(context, 19);
	failTimingBodyStaging(context, fixture, new Error('planned timing body staging failure'));

	await assert.rejects(
		fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/planned timing body staging failure/u,
	);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [], claimKeys: [], tombstoneKeys: [],
	});
});

test('an indeterminate first-body commit immediately cleans its exact operation claim and body', async (context) => {
	const fixture = await createFixture(context, 19);
	failCapturedProxyFirstBodyPublicationReread(context, fixture);

	await assert.rejects(
		fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/committed payload could not be reconciled/iu,
	);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [], claimKeys: [], tombstoneKeys: [],
	});
});

test('a second-body failure releases a reused first claim without deleting its body', async (context) => {
	const fixture = await createFixture(context, 19);
	const candidate = fixture.relationship.candidate();
	const candidateSha256 = await digestMediaContent(candidate);
	const proxyKey = `video-proxy-sha256:${candidateSha256}`;
	await writeCapturedProxyOrdinaryBody(fixture, proxyKey, candidate, {
		name: proxyKey, kind: 'video-proxy', encoding: 'video-proxy-v1', mimeType: candidate.type,
	});
	failTimingBodyStaging(context, fixture, new Error('planned reused timing body staging failure'));

	await assert.rejects(
		fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/planned reused timing body staging failure/u,
	);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [proxyKey], claimKeys: [], tombstoneKeys: [],
	});
});

test('F31 proxy scheduling reuses canonical capture timing without a proxy-specific encoding', async (context) => {
	const fixture = await createFixture(context, 31);
	const candidateSha256 = await digestMediaContent(fixture.relationship.candidate());
	const timing = createVideoTimingAssetPublication(candidateSha256, exactProbeResult());
	await writeCapturedProxyOrdinaryBody(
		fixture,
		timing.reference.storageKey,
		new Blob([timing.bytes.slice()], { type: VIDEO_TIMING_ASSET_MIME_TYPE }),
		{
			name: `${timing.reference.sha256}.scti`,
			kind: 'video-timing',
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		},
	);
	const canonicalMetadata = await fixture.environment.store.getMediaAssetMetadata(
		timing.reference.storageKey,
	);
	assert.equal((canonicalMetadata as Record<string, unknown>).encoding, undefined);

	await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));

	const committed = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	const attachment = videoSource(committed, ORIGINAL_SOURCE_ID).proxyAttachment;
	assert.ok(attachment);
	assert.equal(attachment.timingAsset.storageKey, timing.reference.storageKey);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [attachment.storageKey, timing.reference.storageKey].sort(),
		claimKeys: [],
		tombstoneKeys: [],
	});
});

test('a determinate V19 pre-commit CAS refusal exactly reclaims newly created bodies and claims', async (context) => {
	const fixture = await createFixture(context, 19);
	advanceCanonicalProjectOnThirdLoad(context, fixture);

	await assert.rejects(
		fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/base changed before compare-and-swap/iu,
	);

	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [], claimKeys: [], tombstoneKeys: [],
	});
	assert.equal((await fixture.environment.claimCleanup.reconcile({
		sessionProjects: fixture.session.getSnapshot().tabs.map(({ history }: { history: unknown }) => (
			(history as { present: unknown }).present
		)),
		histories: fixture.session.getSnapshot().tabs.map(({ history }: { history: unknown }) => history),
		pendingSaveSnapshots: [],
	})).status, 'settled');
});

test('a successful desktop publication settles both reused proxy claims', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createFixture(context, 18, true, undefined, main);
	await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	const first = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(first);
	const attachment = videoSource(first, ORIGINAL_SOURCE_ID).proxyAttachment;
	assert.ok(attachment);

	await fixture.schedule(request(fixture.origin, 'second-video', fixture.originalSha256));

	const committed = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	assert.deepEqual(videoSource(committed, 'second-video').proxyAttachment, attachment);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [attachment.storageKey, attachment.timingAsset.storageKey].sort(),
		claimKeys: [],
		tombstoneKeys: [],
	});
});

test('a different capture session cannot inherit another session\'s proxy revision lineage', async (context) => {
	const fixture = await createFixture(context, 19, true);
	await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	await assert.rejects(
		fixture.schedule({
			...request(fixture.origin, 'second-video', fixture.originalSha256),
			sessionId: 'different-capture-session',
		}),
		/origin revision is no longer current/iu,
	);
	const committed = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	assert.equal(videoSource(committed, 'second-video').proxyAttachment, null);
});

test('same capture lineage authorizes a second video after an arbitrarily long derivative delay', async (context) => {
	const fixture = await createFixture(context, 19, true);
	await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	const delayedNow = Date.now() + 60 * 60_000;
	context.mock.method(Date, 'now', () => delayedNow);

	await fixture.schedule(request(fixture.origin, 'second-video', fixture.originalSha256));
	const committed = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	assert.ok(videoSource(committed, 'second-video').proxyAttachment);
});

test('captured proxy lineage capacity evicts the oldest completed capture chain', async (context) => {
	const fixture = await createFixture(context, 19, true);
	const second = fixture.environment.runtime.createProject({
		...structuredClone(fixture.origin),
		id: 'captured-proxy-lineage-second-project',
		title: 'Second lineage project',
	} as never) as unknown as Record<string, unknown>;
	assert.ok(await fixture.environment.createProjectIfAbsent(second as never));
	fixture.session.openProject(second as never, { activate: false });
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment,
		fixture.session,
		{
			runtime: null,
			candidateObserver: fixture.relationship.candidateObserver,
			maximumLineageEntries: 1,
		},
	);
	await schedule({
		...request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256),
		sessionId: 'oldest-lineage-session',
	});
	await schedule({
		...request(second, ORIGINAL_SOURCE_ID, fixture.originalSha256),
		sessionId: 'newest-lineage-session',
	});

	await assert.rejects(schedule({
		...request(fixture.origin, 'second-video', fixture.originalSha256),
		sessionId: 'oldest-lineage-session',
	}), /origin revision is no longer current/iu);
});

test('the app synchronizer leaves an inactive origin alone and advances active state, playback, and snapshot', async (context) => {
	const fixture = await createFixture(context, 18, true);
	let appProject = fixture.active;
	let appHistory = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.active.id,
	)!.history as Record<string, unknown>;
	let playbackProject: Readonly<Record<string, unknown>> | null = null;
	let publishedProject: Readonly<Record<string, unknown>> | null = null;
	const synchronizeActiveProject = createFramescaperCaptureProxyActiveProjectSynchronizer({
		getActiveProject: () => appProject,
		setActiveProject: (value) => { appProject = value; },
		setActiveHistory: (value) => { appHistory = value; },
		applyProjectToPlaybackEngine: (value) => { playbackProject = value; },
		publishProjectState: () => { publishedProject = appProject; },
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV18(
		fixture.environment,
		fixture.session,
		{ runtime: null, candidateObserver: fixture.relationship.candidateObserver, synchronizeActiveProject },
	);

	await schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	assert.equal(appProject, fixture.active);
	assert.equal(playbackProject, null);
	assert.equal(publishedProject, null);

	fixture.session.switchProject(String(fixture.origin.id));
	appHistory = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
	)!.history as Record<string, unknown>;
	appProject = appHistory.present as Record<string, unknown>;
	await schedule(request(fixture.origin, 'second-video', fixture.originalSha256));

	assert.equal(Number(appProject.revision), Number(fixture.origin.revision) + 2);
	assert.ok(videoSource(appProject, 'second-video').proxyAttachment);
	assert.equal(appHistory.present, appProject);
	assert.equal(playbackProject, appProject);
	assert.equal(publishedProject, appProject);
});

test('a capture-derived V18 proxy survives .scape roundtrip, reopen, and ordinary preview selection', async (context) => {
	const fixture = await createFixture(context, 18);
	await fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	const committed = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	const exported = await (fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>)
		.scapeProjectFile.exportProject(committed as never);
	assert.ok(exported.blob);
	assert.equal(exported.manifest.formatVersion, 2);
	assert.deepEqual(
		(exported.manifest.assets as readonly Record<string, unknown>[]).map(({ kind }) => kind),
		['video', 'video-proxy', 'video-timing'],
	);

	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const destination = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: { indexedDB, preferOpfs: false, storageManager: persistentStorage() },
	});
	const imported = await destination.scapeProjectFile.importProject(exported.blob, {
		decision: 'continue',
		operationId: 'capture-derived-proxy-roundtrip',
		publication: { mode: 'create' },
	});
	assert.equal(imported.status, 'published');
	await destination.close();

	const reopened = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: { indexedDB, preferOpfs: false, storageManager: persistentStorage() },
	});
	context.after(() => reopened.close());
	const loaded = await reopened.store.loadProject(String(fixture.origin.id));
	assert.deepEqual(loaded, committed);
	const preview = await resolveFramescaperVideoProxyPreviewV18(
		previewPorts(reopened, loaded),
		{ sourceId: ORIGINAL_SOURCE_ID },
	);
	assert.equal(preview.kind, 'proxy');
	assert.ok(preview.kind === 'proxy');
	assert.equal(preview.body.size, fixture.relationship.candidate().size);
	assert.equal(preview.audioPolicy, 'ignore-proxy-container-audio-v1');
});

test('a throwing tab-reservation release cannot strand the product proxy budget', { timeout: 2_000 }, async (context) => {
	const fixture = await createFixture(context, 18, true);
	const schedule = createFramescaperCapturedVideoProxySchedulerV18(
		fixture.environment,
		releaseThrowingSession(fixture.session),
		{ runtime: null, candidateObserver: fixture.relationship.candidateObserver },
	);

	await assert.rejects(
		schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/planned reservation release failure/u,
	);
	await schedule(request(fixture.origin, 'second-video', fixture.originalSha256));

	const committed = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(committed);
	assert.ok(videoSource(committed, ORIGINAL_SOURCE_ID).proxyAttachment);
	assert.ok(videoSource(committed, 'second-video').proxyAttachment);
});

test('scheduler disposal cancels a queued product proxy budget waiter', { timeout: 2_000 }, async (context) => {
	const fixture = await createFixture(context, 19);
	const releaseBudget = await acquireFramescaperVideoProxyAttachmentBudgetV18(fixture.environment.store);
	try {
		const pending = fixture.schedule(request(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
		const rejection = assert.rejects(pending, /disposed|cancel/iu);
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		await fixture.schedule.dispose();
		await rejection;
		assert.equal(fixture.relationship.counters.generatorCalls, 0);
	} finally { releaseBudget(); }
});

function previewPorts(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	project: unknown,
): FramescaperVideoProxyPreviewPortsV18 {
	const task = Object.freeze({ project });
	return Object.freeze({
		profile: environment.runtime.profile,
		getProject: () => project,
		captureTask: () => task,
		assertTaskCurrent: (value: unknown) => {
			if (value !== task) throw new DOMException('Preview task changed.', 'AbortError');
		},
		acquireBody: async (bodyRequest: Readonly<FramescaperVideoProxyBodyRequestV18>) => {
			const body = await environment.store.loadMediaAsset(bodyRequest.expected.storageKey);
			if (!(body instanceof Blob)) throw new Error('The reopened proxy body is unavailable.');
			return Object.freeze({
				identity: Object.freeze({
					...bodyRequest.expected,
					generationToken: `${bodyRequest.expected.kind}:${bodyRequest.expected.sha256}`,
				}),
				body,
				assertCurrent() {},
				release() {},
			});
		},
		observeOriginal: async (originalRequest: Readonly<FramescaperVideoProxyOriginalRequestV18>) => {
			const body = await environment.store.loadMediaAsset(originalRequest.storageKey);
			if (!(body instanceof Blob)) throw new Error('The reopened original body is unavailable.');
			const source = videoSource(project, originalRequest.sourceId);
			return Object.freeze({
				identity: Object.freeze({
					authority: 'owned' as const,
					projectId: originalRequest.projectId,
					sourceId: originalRequest.sourceId,
					storageKey: originalRequest.storageKey,
					mimeType: originalRequest.mimeType,
					byteLength: body.size,
					sha256: originalRequest.contentSha256,
					generationToken: `owned:${originalRequest.storageKey}:${originalRequest.contentSha256}`,
				}),
				timing: bindVideoSourceTimingView(
					resolveVideoSourceTimingViews(project),
					source,
				),
				assertCurrent() {},
				release() {},
			});
		},
	});
}

function releaseThrowingSession(session: Fixture['session']): unknown {
	let plannedFailure = true;
	return Object.freeze({
		getSnapshot: () => session.getSnapshot(),
		captureProjectHistory: (projectId: string) => session.captureProjectHistory(projectId),
		assertProjectHistoryToken: (projectId: string, token: object) => (
			session.assertProjectHistoryToken(projectId, token)
		),
		beginProjectActivation: (
			projectId: string,
			options: Parameters<typeof session.beginProjectActivation>[1],
		) => {
			const reservation = session.beginProjectActivation(projectId, options);
			return Object.freeze({
				token: reservation.token,
				release() {
					const released = reservation.release();
					if (plannedFailure) {
						plannedFailure = false;
						throw new Error('planned reservation release failure');
					}
					return released;
				},
			});
		},
		installCommittedProjectHistory: (
			projectId: string,
			history: Parameters<typeof session.installCommittedProjectHistory>[1],
			options: Parameters<typeof session.installCommittedProjectHistory>[2],
		) => session.installCommittedProjectHistory(projectId, history, options),
	});
}

function failTimingBodyStaging(
	context: TestContext,
	fixture: Fixture,
	failure: Error,
): void {
	const store = fixture.environment.store;
	const original = store.beginMediaAssetWrite;
	Object.defineProperty(store, 'beginMediaAssetWrite', {
		configurable: true,
		value: (sourceId: string, ...args: unknown[]) => {
			if (sourceId.startsWith('video-timing-sha256:')) throw failure;
			return Reflect.apply(original, store, [sourceId, ...args]) as ReturnType<typeof original>;
		},
	});
	context.after(() => { delete (store as unknown as Record<string, unknown>).beginMediaAssetWrite; });
}

function advanceCanonicalProjectOnThirdLoad(context: TestContext, fixture: Fixture): void {
	const store = fixture.environment.store;
	const original = store.loadProject;
	let loadCalls = 0;
	Object.defineProperty(store, 'loadProject', {
		configurable: true,
		value: async (projectId: string, options?: unknown) => {
			loadCalls += 1;
			if (loadCalls === 3) {
				await store.saveProject(nextOrdinaryRevision(
					fixture.environment,
					fixture.origin,
					'Advanced before captured proxy CAS',
				) as never);
			}
			return Reflect.apply(original, store, options === undefined ? [projectId] : [projectId, options]);
		},
	});
	context.after(() => { delete (store as unknown as Record<string, unknown>).loadProject; });
}
