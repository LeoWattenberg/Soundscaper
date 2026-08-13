/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { openDatabase, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../src/common/editor/storage/media-asset-staging-schema.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../src/framescaper/editor-project-environment-v18.ts';
import {
	createFramescaperProjectMaintenanceCoordinatorV18,
} from '../src/framescaper/editor-project-v18-maintenance.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-13T12:00:00.000Z';
const BASE_FINGERPRINT = '12'.repeat(32);

test('maintenance authenticates the product environment before reading a scope', async (context) => {
	const fixture = await createFixture(context);
	let scopeTraps = 0;
	const scope = new Proxy({}, {
		get() { scopeTraps += 1; throw new Error('scope getter'); },
		getOwnPropertyDescriptor() { scopeTraps += 1; throw new Error('scope descriptor'); },
		getPrototypeOf() { scopeTraps += 1; throw new Error('scope prototype'); },
		ownKeys() { scopeTraps += 1; throw new Error('scope keys'); },
	});
	assert.throws(
		() => createFramescaperProjectMaintenanceCoordinatorV18({ ...fixture.environment }),
		/exact.*environment/iu,
	);
	assert.equal(scopeTraps, 0);

	const coordinator = createFramescaperProjectMaintenanceCoordinatorV18(fixture.environment);
	await assert.rejects(
		coordinator.reconcileAndCollectStorageRoots(scope),
		/scope prototype|maintenance scope/iu,
	);
	assert.equal(scopeTraps > 0, true);
});

test('maintenance snapshots every runtime root category before cleanup and retention', async (context) => {
	const fixture = await createFixture(context);
	const coordinator = createFramescaperProjectMaintenanceCoordinatorV18(fixture.environment);
	const project = fixture.environment.runtime.createProject({
		id: 'maintenance-complete-scope', title: 'Maintenance complete scope', now: NOW,
	});
	const history = fixture.environment.runtime.createHistory(project);
	const pendingSaveSnapshots = new Set([project]);
	const scope = {
		currentProject: project,
		retainedRevisions: [],
		sessionProjects: [project],
		histories: [history],
		pendingSaveSnapshots,
		claims: [],
	};

	const operation = coordinator.reconcileAndCollectStorageRoots(scope);
	pendingSaveSnapshots.clear();
	const result = await operation;

	assert.equal(result.cleanup.status, 'settled');
	assert.deepEqual(result.storageRoots, []);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.storageRoots), true);
	for (const field of ['currentProject', 'retainedRevisions', 'sessionProjects', 'histories',
		'pendingSaveSnapshots', 'claims'] as const) {
		const incomplete = { ...scope } as Record<string, unknown>;
		delete incomplete[field];
		await assert.rejects(
			coordinator.reconcileAndCollectStorageRoots(incomplete),
			/unsupported, missing, or extra fields/iu,
		);
	}
});

test('indeterminate cleanup refuses retention collection even when retention limits are invalid', async (context) => {
	const fixture = await createFixture(context);
	const coordinator = createFramescaperProjectMaintenanceCoordinatorV18(fixture.environment);
	const project = fixture.environment.runtime.createProject({
		id: 'maintenance-indeterminate', title: 'Maintenance indeterminate', now: NOW,
	});
	await seedMalformedClaim(fixture.database);

	await assert.rejects(
		coordinator.reconcileAndCollectStorageRoots({
			currentProject: project,
			retainedRevisions: [],
			sessionProjects: [project],
			histories: [fixture.environment.runtime.createHistory(project)],
			pendingSaveSnapshots: [],
			claims: [],
		}, { maximumRoots: 0 }),
		/maintenance claim cleanup is indeterminate/iu,
	);
});

test('determinate prepublication cleanup accepts only an exact operation and settled cleanup', async (context) => {
	const fixture = await createFixture(context);
	const coordinator = createFramescaperProjectMaintenanceCoordinatorV18(fixture.environment);
	const project = fixture.environment.runtime.createProject({
		id: 'maintenance-operation', title: 'Maintenance operation', now: NOW,
	});
	const runtimeScope = {
		sessionProjects: [project],
		histories: [fixture.environment.runtime.createHistory(project)],
		pendingSaveSnapshots: new Set([project]),
	};
	const operation = {
		operationId: 'maintenance-operation',
		projectId: project.id,
		sourceId: 'video-source',
		baseFingerprint: BASE_FINGERPRINT,
	};

	const settled = await coordinator.cleanupDeterminatePrepublicationFailure(operation, runtimeScope);
	assert.equal(settled.status, 'settled');
	assert.throws(
		() => coordinator.cleanupDeterminatePrepublicationFailure(
			{ ...operation, baseFingerprint: 'not-a-digest' }, runtimeScope,
		),
		/lowercase SHA-256/iu,
	);
	await seedMalformedClaim(fixture.database);
	await assert.rejects(
		coordinator.cleanupDeterminatePrepublicationFailure(operation, runtimeScope),
		/prepublication claim cleanup is indeterminate/iu,
	);
});

interface Fixture {
	readonly database: IDBDatabase;
	readonly environment: Readonly<FramescaperEditorProjectEnvironmentV18>;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: { indexedDB, preferOpfs: false },
	});
	context.after(() => environment.close());
	const database = await openDatabase(indexedDB, environment.store.databaseName);
	context.after(() => database.close());
	return { database, environment };
}

async function seedMalformedClaim(database: IDBDatabase): Promise<void> {
	await transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', ({ mediaAssetStaging }) => {
		mediaAssetStaging.put({
			key: `malformed-maintenance-${String(Date.now())}`,
			kind: 'video-proxy-claim',
		});
	});
}
