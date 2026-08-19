/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { transact, request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import {
	proveVideoProxyRelationship,
} from '../src/common/editor/video-proxy-relationship.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import {
	createFramescaperVideoProxyAttachmentControllerGateV18,
} from '../src/framescaper/editor-video-proxy-controller-gate-v18.ts';
import {
	FramescaperVideoProxyAttachmentCoordinatorV18,
} from '../src/framescaper/editor-video-proxy-attachment-coordinator-v18.ts';
import { framescaperProjectStoreAuthorityV18 } from '../src/framescaper/editor-project-store-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import {
	ORIGINAL_SOURCE_ID,
	createVideoProxyFixture,
} from './helpers/video-proxy-relationship-fixtures.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const OPERATION_ID = 'attach-proxy-operation';

test('coordinator consumes preparation and atomically installs one committed attachment', async (context) => {
	const environment = await createEnvironment(context, persistentStorage());
	const relationship = createVideoProxyFixture();
	const base = v18Base(environment, relationship.project());
	assert.deepEqual(await environment.createProjectIfAbsent(base), base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);
	const gate = createFramescaperVideoProxyAttachmentControllerGateV18(environment, session);
	const coordinator = new FramescaperVideoProxyAttachmentCoordinatorV18(
		environment,
		gate,
		relationship.authority,
	);
	const observed: unknown[] = [];
	const unsubscribe = session.subscribe((snapshot: unknown) => observed.push(snapshot));
	context.after(unsubscribe);
	const prepared = await proveVideoProxyRelationship(relationship.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});

	const result = await coordinator.attach({
		preparation: prepared,
		sourceId: ORIGINAL_SOURCE_ID,
		operationId: OPERATION_ID,
	});

	assert.equal(result.committed, true);
	assert.equal(result.project.revision, base.revision + 1);
	const source = result.project.sources.find((candidate) => candidate.id === ORIGINAL_SOURCE_ID)!;
	assert.equal(source.kind, 'video');
	assert.ok(source.kind === 'video' && source.proxyAttachment);
	const attachment = source.kind === 'video' ? source.proxyAttachment : null;
	assert.ok(attachment);
	assert.equal(attachment.sha256, await digestMediaContent(prepared.candidate));
	assert.equal(attachment.byteLength, prepared.candidate.size);
	assert.equal(attachment.mimeType, prepared.candidate.type);
	assert.equal(attachment.originalSha256, source.contentSha256);
	assert.equal(attachment.timingAsset.sourceSha256, attachment.sha256);
	assert.equal(Object.isFrozen(attachment), true);
	assert.deepEqual(await environment.store.loadProject(base.id), result.project);

	const snapshot = session.getSnapshot();
	const tab = snapshot.tabs.find((candidate: { projectId: string }) => candidate.projectId === base.id)!;
	// The tab stays editable. An attachment used to install read-only, which made
	// generating a proxy cost the session every edit that came after it.
	assert.equal(tab.readOnly, false);
	assert.equal(tab.readOnlyReason, null);
	assert.deepEqual(tab.history.present, result.project);
	// One undoable step, so the attachment can be taken back the way it arrived.
	assert.deepEqual(tab.history.undoStack.at(-1)?.project, base);
	// And every published snapshot is either the base or the committed result —
	// no half-installed state reaches a subscriber.
	for (const value of observed) {
		const candidate = value as ReturnType<typeof session.getSnapshot>;
		const current = candidate.tabs.find((entry: { projectId: string }) => entry.projectId === base.id);
		if (!current) continue;
		const present = current.history.present as Record<string, unknown>;
		assert.ok(
			present.revision === base.revision || present.revision === result.project.revision,
			`published revision ${String(present.revision)}`,
		);
	}

	const authority = framescaperProjectStoreAuthorityV18(PROFILE, environment.store);
	const database = await authority.port.database();
	assert.ok(database);
	const claims = await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readonly', ({ mediaAssetStaging }) => (
		request(mediaAssetStaging.index('kind').getAll('video-proxy-claim'))
	));
	assert.deepEqual(claims, []);
	assert.ok(relationship.counters.originalOpens >= 2);
	assert.equal(relationship.counters.originalOpens, relationship.counters.originalReleases);
});

test('exclusive controller gate blocks project mutation, tab lifecycle, switch, and teardown', async (context) => {
	const environment = await createEnvironment(context, persistentStorage());
	const relationship = createVideoProxyFixture();
	const base = v18Base(environment, relationship.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);
	const other = environment.runtime.createProject({ id: 'other-project', title: 'Other' });
	session.openProject(other, { activate: false });
	const gate = createFramescaperVideoProxyAttachmentControllerGateV18(environment, session);
	const ticket = await gate.capture({ sourceId: ORIGINAL_SOURCE_ID });

	assert.throws(() => session.updateProject(base.id, { ...base, title: 'Mutated' }), /reserved|gate|attachment/iu);
	assert.throws(() => session.updateProjectHistory(base.id, session.getProjectHistory(base.id)), /reserved|gate/iu);
	assert.throws(() => session.switchProject(other.id), /reserved|gate/iu);
	assert.throws(
		() => session.openProject(environment.runtime.createProject({ id: 'third-project' }), { activate: false }),
		/reserved|gate/iu,
	);
	assert.throws(() => session.closeProject(other.id, { force: true }), /reserved|gate/iu);
	assert.throws(() => session.setProjectReadOnly(base.id, true), /reserved|gate/iu);
	assert.throws(() => session.markProjectSaved(base.id), /reserved|gate/iu);
	assert.throws(() => session.dispose(), /reserved|gate/iu);

	await gate.release(ticket);
	assert.equal(session.switchProject(other.id), true);
	session.dispose();
});

test('unknown persistence or quota hard-stops before either immutable body is staged', async (context) => {
	const environment = await createEnvironment(context, null);
	const relationship = createVideoProxyFixture();
	const base = v18Base(environment, relationship.project());
	await environment.createProjectIfAbsent(base);
	const session = environment.runtime.createSessionController();
	session.openProject(base);
	const gate = createFramescaperVideoProxyAttachmentControllerGateV18(environment, session);
	const coordinator = new FramescaperVideoProxyAttachmentCoordinatorV18(
		environment,
		gate,
		relationship.authority,
	);
	const prepared = await proveVideoProxyRelationship(relationship.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	const candidateDigest = await digestMediaContent(prepared.candidate);

	await assert.rejects(coordinator.attach({
		preparation: prepared,
		sourceId: ORIGINAL_SOURCE_ID,
		operationId: 'unknown-capacity',
	}), /persistent|quota|capacity|estimate/iu);

	assert.deepEqual(await environment.store.loadProject(base.id), base);
	assert.equal(await environment.store.getMediaAssetMetadata(`video-proxy-sha256:${candidateDigest}`), null);
	assert.equal(session.getSnapshot().tabs[0]?.readOnly, false);
	session.dispose();
	assert.equal(session.getSnapshot().disposed, true);
});

async function createEnvironment(
	context: TestContext,
	storageManager: StorageManager | null,
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
			storageManager,
		},
	});
	context.after(() => environment.close());
	return environment;
}

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}

function v18Base(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
	v17: Record<string, unknown>,
): FramescaperProjectV18 {
	return environment.runtime.createProject({
		...v17,
		sources: (v17.sources as Record<string, unknown>[]).filter((source) => source.kind === 'video'),
		takeGroups: [],
	} as never);
}
