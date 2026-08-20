/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureProxySaveQuiescence,
	type FramescaperCaptureProxySaveLease,
} from '../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV18,
	createFramescaperCapturedVideoProxySchedulerV19,
} from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import type { FramescaperEditorProjectEnvironmentV18 } from '../src/framescaper/editor-project-environment-v18.ts';
import type { FramescaperEditorProjectEnvironmentV19 } from '../src/framescaper/editor-project-environment-v19.ts';
import { FramescaperDesktopV10MainFixture } from './helpers/framescaper-desktop-v10-store-fixture.ts';
import {
	capturedProxyRequest,
	capturedProxyStorageInventory,
	capturedVideoSource,
	createCapturedProxyFixture,
	nextCapturedProxyOrdinaryRevision,
	type CapturedProxyFixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';
import { ORIGINAL_SOURCE_ID, deferred } from './helpers/video-proxy-relationship-fixtures.ts';

test('save quiescence suspends and drains an active origin, then resumes its dirty autosave', async () => {
	const drain = deferred<void>();
	const events: string[] = [];
	const acquire = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => 'origin',
		hasUnsavedProjectChanges: () => true,
		saves: {
			suspendProject: (projectId) => { events.push(`suspend:${projectId}`); },
			resumeProject: (projectId) => { events.push(`resume:${projectId}`); return true; },
			scheduleAutosave: () => { events.push('schedule'); return true; },
			drain: () => { events.push('drain'); return drain.promise; },
		},
	});

	const pending = acquire('origin');
	assert.deepEqual(events, ['suspend:origin', 'drain']);
	drain.resolve();
	const lease = await pending;
	assert.deepEqual(events, ['suspend:origin', 'drain']);
	assert.equal(lease.release(), true);
	assert.equal(lease.release(), false);
	assert.deepEqual(events, ['suspend:origin', 'drain', 'resume:origin', 'schedule']);
});

test('save quiescence drains an inactive origin without cancelling its unrelated active tab', async () => {
	const events: string[] = [];
	const acquire = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => 'unrelated-active',
		hasUnsavedProjectChanges: () => true,
		saves: {
			suspendProject: (projectId) => { events.push(`suspend:${projectId}`); },
			resumeProject: (projectId) => { events.push(`resume:${projectId}`); return true; },
			scheduleAutosave: () => { events.push('schedule'); return true; },
			drain: () => { events.push('drain'); },
		},
	});

	const lease = await acquire('origin');
	assert.equal(lease.release(), true);
	assert.deepEqual(events, ['suspend:origin', 'drain', 'resume:origin']);
});

test('V19 drains a blocked origin save before ticket capture and aborts instead of overwriting it', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	fixture.session.switchProject(String(fixture.origin.id));
	const saveEntered = deferred<void>();
	const releaseSave = deferred<void>();
	let edited: Record<string, unknown> | null = null;
	let releases = 0;
	let ticketCaptures = 0;
	const session = instrumentSession(fixture, () => { ticketCaptures += 1; });
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		session,
		composition(fixture, async () => {
			saveEntered.resolve();
			await releaseSave.promise;
			assert.ok(edited);
			await fixture.environment.store.saveProject(edited as never);
			return lease(() => { releases += 1; });
		}),
	);
	const pending = schedule(capturedProxyRequest(
		fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
	));
	await saveEntered.promise;
	assert.equal(ticketCaptures, 0, 'queued saves drain before the exclusive history ticket');
	edited = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.origin, 'Queued origin edit');
	fixture.session.updateProject(String(fixture.origin.id), edited);
	releaseSave.resolve();

	await assert.rejects(pending, /changed while queued saves drained/iu);
	assert.equal(ticketCaptures, 0, 'a changed durable base never enters final proxy CAS');
	assert.equal(releases, 1);
	const durable = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(durable);
	assert.equal(durable.title, 'Queued origin edit');
	assert.equal(capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment, null);
	assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
		bodyKeys: [], claimKeys: [], tombstoneKeys: [],
	});
});

test('a landed retry reacquires save and history fences before awaited cleanup', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	fixture.session.switchProject(String(fixture.origin.id));
	const cleanup = fixture.environment.claimCleanup as unknown as {
		cleanupOperation: (...args: unknown[]) => Promise<unknown>;
	};
	const originalCleanup = cleanup.cleanupOperation.bind(cleanup);
	const cleanupEntered = deferred<void>();
	const releaseCleanup = deferred<void>();
	let cleanupCalls = 0;
	cleanup.cleanupOperation = async (...args) => {
		cleanupCalls += 1;
		if (cleanupCalls === 1) throw new Error('planned initial cleanup failure');
		if (cleanupCalls === 2) {
			cleanupEntered.resolve();
			await releaseCleanup.promise;
		}
		return originalCleanup(...args);
	};
	context.after(() => { cleanup.cleanupOperation = originalCleanup; });
	let suspended = false;
	const saves = {
		suspendProject: () => { suspended = true; },
		resumeProject: () => { suspended = false; return true; },
		scheduleAutosave: () => !suspended,
		drain: () => undefined,
	};
	const acquire = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => String(fixture.origin.id),
		hasUnsavedProjectChanges: () => false,
		saves,
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV18(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>,
		fixture.session,
		composition(fixture, acquire),
	);

	await assert.rejects(
		schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256)),
		/Captured proxy cleanup failed/u,
	);
	await cleanupEntered.promise;
	assert.equal(suspended, true, 'automatic landed retry suspends active-origin save admission');
	const edit = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.origin, 'Forbidden retry edit');
	assert.throws(
		() => fixture.session.updateProject(String(fixture.origin.id), edit),
		/reserved|gate/iu,
	);
	assert.equal(saves.scheduleAutosave(), false, 'a stale autosave cannot enter during landed cleanup');
	const durableDuringCleanup = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(durableDuringCleanup);
	assert.ok(capturedVideoSource(durableDuringCleanup, ORIGINAL_SOURCE_ID).proxyAttachment);
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision));
	releaseCleanup.resolve();
	await waitFor(
		() => originTabRevision(fixture) === Number(fixture.origin.revision) + 1,
		'landed cleanup retry did not install its fenced target',
	);
	assert.equal(suspended, false);
});

test('V18 scopes upload save suspension to origin across switch, edit, timer, and undo', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	const suspendedProjects = new Set<string>();
	let autosaveAdmissions = 0;
	const scheduleAutosave = () => {
		const activeProjectId = fixture.session.getSnapshot().activeProjectId;
		if (activeProjectId && suspendedProjects.has(activeProjectId)) return false;
		autosaveAdmissions += 1;
		return true;
	};
	const acquire = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => fixture.session.getSnapshot().activeProjectId,
		hasUnsavedProjectChanges: () => false,
		saves: {
			suspendProject: (projectId) => { suspendedProjects.add(projectId); },
			resumeProject: (projectId) => suspendedProjects.delete(projectId),
			scheduleAutosave,
			drain: () => undefined,
		},
	});
	const uploadEntered = deferred<void>();
	const releaseUpload = deferred<void>();
	main.afterUpload = async () => { uploadEntered.resolve(); await releaseUpload.promise; };
	const schedule = createFramescaperCapturedVideoProxySchedulerV18(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>,
		fixture.session,
		composition(fixture, acquire),
	);
	const publicationsBefore = main.publications;
	const pending = schedule(capturedProxyRequest(
		fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
	));
	await uploadEntered.promise;
	assert.equal(suspendedProjects.has(String(fixture.origin.id)), true);
	const editedActive = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.active, 'Unrelated upload edit');
	fixture.session.updateProject(String(fixture.active.id), editedActive);
	assert.equal(scheduleAutosave(), true, 'an unrelated active autosave remains admitted');
	assert.equal(fixture.session.switchProject(String(fixture.origin.id)), true);
	const editedOrigin = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.origin, 'Undone upload edit');
	fixture.session.updateProject(String(fixture.origin.id), editedOrigin);
	assert.equal(scheduleAutosave(), false, 'the switched-to origin cannot enqueue a stale snapshot');
	fixture.session.updateProject(String(fixture.origin.id), fixture.origin);
	assert.equal(scheduleAutosave(), false, 'undo-to-base stays fenced until proxy installation');
	releaseUpload.resolve();

	await pending;
	assert.equal(main.publications, publicationsBefore + 1);
	const durable = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(durable);
	assert.ok(capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment);
	assert.equal(originTabRevision(fixture), Number(fixture.origin.revision) + 1);
	assert.equal(suspendedProjects.size, 0);
	assert.equal(autosaveAdmissions, 1);
});

test('V18 holds the exact origin ticket across main finish and session installation', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	let finishObserved = false;
	main.beforeFinish = async () => {
		finishObserved = true;
		const edit = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.origin, 'Forbidden final edit');
		assert.throws(
			() => fixture.session.updateProject(String(fixture.origin.id), edit),
			/reserved|gate/iu,
		);
	};

	await fixture.schedule(capturedProxyRequest(
		fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
	));
	assert.equal(finishObserved, true);
	const durable = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(durable);
	assert.ok(capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment);
	const tab = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
	);
	assert.equal((tab?.history.present as Record<string, unknown>).revision, durable.revision);
});

test('V19 holds the exact origin ticket across browser CAS and session installation', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	fixture.session.switchProject(String(fixture.origin.id));
	let presentReservations = 0;
	const session = instrumentSession(fixture, () => undefined, (options) => {
		if (!('expectedHistoryToken' in options)) return;
		presentReservations += 1;
		const edit = nextCapturedProxyOrdinaryRevision(fixture.environment, fixture.origin, 'Forbidden V19 edit');
		assert.throws(
			() => fixture.session.updateProject(String(fixture.origin.id), edit),
			/reserved|gate/iu,
		);
	});
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
		session,
		composition(fixture, async () => lease()),
	);

	await schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
	assert.equal(presentReservations, 1);
	const durable = await fixture.environment.store.loadProject(String(fixture.origin.id));
	assert.ok(durable);
	assert.ok(capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment);
	assert.equal(originTabRevision(fixture), Number(durable.revision));
});

for (const schemaVersion of [18, 19] as const) {
	test(`V${String(schemaVersion)} reserves an absent origin through final CAS`, async (context) => {
		const main = schemaVersion === 18 ? new FramescaperDesktopV10MainFixture() : undefined;
		if (main) main.acceptBodies = true;
		const fixture = await createCapturedProxyFixture(context, schemaVersion, false, undefined, main);
		fixture.session.closeProject(String(fixture.origin.id), { force: true });
		let absentReservations = 0;
		const session = instrumentSession(fixture, () => undefined, (options) => {
			if (!('requireAbsent' in options)) return;
			absentReservations += 1;
			assert.throws(
				() => fixture.session.openProject(fixture.origin as never, { activate: false }),
				/reserved|gate/iu,
			);
		});
		const schedule = schemaVersion === 18
			? createFramescaperCapturedVideoProxySchedulerV18(
				fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV18>,
				session,
				composition(fixture, async () => lease()),
			)
			: createFramescaperCapturedVideoProxySchedulerV19(
				fixture.environment as Readonly<FramescaperEditorProjectEnvironmentV19>,
				session,
				composition(fixture, async () => lease()),
			);

		await schedule(capturedProxyRequest(fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256));
		assert.equal(absentReservations, 1);
		const durable = await fixture.controllerStore.loadProject(String(fixture.origin.id));
		assert.ok(durable);
		assert.ok(capturedVideoSource(durable, ORIGINAL_SOURCE_ID).proxyAttachment);
		fixture.session.openProject(durable as never, { activate: false });
		assert.equal(originTabRevision(fixture), Number(fixture.origin.revision) + 1);
	});
}

function composition(
	fixture: CapturedProxyFixture,
	quiesceProjectSaves: (
		projectId: string,
		signal?: AbortSignal,
	) => PromiseLike<FramescaperCaptureProxySaveLease> | FramescaperCaptureProxySaveLease,
) {
	return {
		runtime: null,
		candidateObserver: fixture.relationship.candidateObserver,
		quiesceProjectSaves,
	};
}

function lease(onRelease: () => void = () => undefined): FramescaperCaptureProxySaveLease {
	let released = false;
	return Object.freeze({
		release(): boolean {
			if (released) return false;
			released = true;
			onRelease();
			return true;
		},
	});
}

function instrumentSession(
	fixture: CapturedProxyFixture,
	onCapture: () => void,
	onBegin: (options: Readonly<Record<string, unknown>>) => void = () => undefined,
) {
	return Object.freeze({
		getSnapshot: () => fixture.session.getSnapshot(),
		captureProjectHistory: (projectId: string) => {
			onCapture();
			return fixture.session.captureProjectHistory(projectId);
		},
		assertProjectHistoryToken: (projectId: string, token: object) => (
			fixture.session.assertProjectHistoryToken(projectId, token)
		),
		beginProjectActivation: (
			projectId: string,
			options: Parameters<typeof fixture.session.beginProjectActivation>[1],
		) => {
			const reservation = fixture.session.beginProjectActivation(projectId, options);
			onBegin(options);
			return reservation;
		},
		installCommittedProjectHistory: (
			projectId: string,
			history: Parameters<typeof fixture.session.installCommittedProjectHistory>[1],
			options: Parameters<typeof fixture.session.installCommittedProjectHistory>[2],
		) => fixture.session.installCommittedProjectHistory(projectId, history, options),
	});
}

function originTabRevision(fixture: CapturedProxyFixture): number {
	const tab = fixture.session.getSnapshot().tabs.find(
		({ projectId }: { projectId: string }) => projectId === fixture.origin.id,
	);
	assert.ok(tab);
	return Number((tab.history.present as Record<string, unknown>).revision);
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	assert.fail(message);
}
