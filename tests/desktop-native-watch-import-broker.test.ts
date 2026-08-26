/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import {
	FramescaperNativeWatchImportBroker,
	type FramescaperNativeWatchImportBrokerOptions,
} from '../desktop/native-services-watch-import-broker.ts';

const DIGEST = 'a'.repeat(64);
const LOCATOR_ID = 'b'.repeat(32);
const LOCATOR_REVISION = 'c'.repeat(32);
const CLAIM_ID = 'd'.repeat(32);
const OWNER = Object.freeze({ owner: 1 });

test('a linked watch claim stays pathless and is retained through durable acknowledgement', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	const claim = fixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 4 });
	assert.ok(claim);
	assert.equal(JSON.stringify(claim).includes('/watched'), false);
	fixture.projectRevision = 5;
	const completion = {
		claimId: CLAIM_ID, projectId: 'project-1', expectedProjectRevision: 4,
		committedProjectRevision: 5, success: true,
	} as const;
	assert.equal(await fixture.broker.complete(OWNER, completion), true);
	assert.equal(await fixture.broker.complete(OWNER, completion), true, 'completion is idempotent');
	assert.equal(await pending, true);
	assert.equal(fixture.releases.length, 0, 'committed link is project-owned');
	assert.equal(await fixture.broker.offer(offer()), true, 'DB retry cannot duplicate the project import');
	assert.equal(fixture.created, 1);
	assert.equal(fixture.broker.recorded(offer()), true);
	await fixture.broker.dispose();
	assert.equal(fixture.releases.length, 0);
});

test('copy and failed claims release their temporary linked locators', async () => {
	const copyFixture = createFixture();
	const copied = copyFixture.broker.offer(offer('copy'));
	await copyFixture.locatorCreated();
	assert.ok(copyFixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 4 }));
	copyFixture.projectRevision = 5;
	assert.equal(await copyFixture.broker.complete(OWNER, {
		claimId: CLAIM_ID, projectId: 'project-1', expectedProjectRevision: 4,
		committedProjectRevision: 5, success: true,
	}), true);
	assert.equal(await copied, true);
	assert.deepEqual(copyFixture.releases, [LOCATOR_ID]);

	const failedFixture = createFixture();
	const failed = failedFixture.broker.offer(offer());
	await failedFixture.locatorCreated();
	assert.ok(failedFixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 4 }));
	assert.equal(await failedFixture.broker.complete(OWNER, {
		claimId: CLAIM_ID, projectId: 'project-1', expectedProjectRevision: 4,
		committedProjectRevision: 5, success: false,
	}), true);
	assert.equal(await failed, false);
	assert.deepEqual(failedFixture.releases, [LOCATOR_ID]);
});

test('stale owner and project revision fail closed while historical V20 still refuses proxy rules', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	assert.equal(fixture.broker.claim({}, { projectId: 'project-1', projectRevision: 4 }), null);
	assert.equal(fixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 3 }), null);
	fixture.projectRevision = 5;
	assert.equal(fixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 4 }), null);
	await fixture.broker.dispose();
	assert.equal(await pending, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID]);

	const blocked = createFixture();
	assert.equal(await blocked.broker.offer({
		...offer(), rule: createWatchRuleV1({
			ruleId: '1'.repeat(32), grantId: '2'.repeat(32), projectId: 'project-1',
			extensions: ['mp4'], generateProxies: true, createdAtMs: 0,
		}),
	}), false);
	assert.equal(blocked.created, 0);
});

test('selected V28 claims bind target bin and proxy choice through digest-bound completion', async () => {
	const fixture = createFixtureV28();
	const pending = fixture.broker.offer(offerV28());
	await fixture.locatorCreated();
	assert.deepEqual(fixture.broker.claim(OWNER, {
		projectId: 'project-28', projectRevision: 4,
	}), {
		claimId: CLAIM_ID, projectId: 'project-28', projectRevision: 4,
		projectSchemaVersion: 28, binId: 'project-bin', generateProxies: true,
		existingSourceId: null, importMode: 'link', locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION, name: 'clip.mp4', size: 4,
		mimeType: 'video/mp4', lastModified: 10, contentSha256: DIGEST,
	});
	fixture.projectRevision = 6;
	fixture.imported = { sourceId: 'source-28', projectRevision: 6, proxyAttached: true };
	const completion = {
		claimId: CLAIM_ID, projectId: 'project-28', projectSchemaVersion: 28,
		binId: 'project-bin', sourceId: 'source-28', contentSha256: DIGEST,
		expectedProjectRevision: 4, committedProjectRevision: 6, success: true,
	} as const;
	assert.equal(await fixture.broker.complete(OWNER, completion), true);
	assert.equal(await fixture.broker.complete(OWNER, completion), true);
	assert.equal(await pending, true);
	assert.equal(fixture.broker.recorded(offerV28()), true);
	assert.deepEqual(fixture.releases, [], 'the linked locator is retained by the exact imported source');
});

test('selected F31 claims preserve their exact schema through digest-bound completion', async () => {
	const fixture = createFixtureV28(31);
	const pending = fixture.broker.offer(offerV28());
	await fixture.locatorCreated();
	const claim = fixture.broker.claim(OWNER, { projectId: 'project-28', projectRevision: 4 });
	assert.ok(claim && 'projectSchemaVersion' in claim);
	assert.equal(claim.projectSchemaVersion, 31);
	fixture.projectRevision = 6;
	fixture.imported = { sourceId: 'source-31', projectRevision: 6, proxyAttached: true };
	assert.equal(await fixture.broker.complete(OWNER, {
		claimId: CLAIM_ID, projectId: 'project-28', projectSchemaVersion: 31,
		binId: 'project-bin', sourceId: 'source-31', contentSha256: DIGEST,
		expectedProjectRevision: 4, committedProjectRevision: 6, success: true,
	}), true);
	assert.equal(await pending, true);
});

test('selected V28 restart resumes a missing proxy without duplicating the imported digest', async () => {
	const fixture = createFixtureV28();
	fixture.imported = { sourceId: 'source-28', projectRevision: 4, proxyAttached: false };
	const pending = fixture.broker.offer(offerV28());
	await fixture.locatorCreated();
	assert.equal(fixture.created, 1);
	const claim = fixture.broker.claim(OWNER, {
		projectId: 'project-28', projectRevision: 4,
	});
	assert.ok(claim && 'existingSourceId' in claim);
	assert.equal(claim.existingSourceId, 'source-28');
	await fixture.broker.dispose();
	assert.equal(await pending, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID],
		'proxy-only recovery releases its unused locator while the landed source keeps its prior link');

	const completed = createFixtureV28();
	completed.imported = { sourceId: 'source-28', projectRevision: 5, proxyAttached: true };
	completed.projectRevision = 5;
	assert.equal(await completed.broker.offer(offerV28()), true);
	assert.equal(completed.created, 0, 'proxy-complete restart records without another locator or import');
});

test('selected V28 completion rechecks the project generation after async digest inspection', async () => {
	const fixture = createFixtureV28();
	const pending = fixture.broker.offer(offerV28());
	await fixture.locatorCreated();
	assert.ok(fixture.broker.claim(OWNER, { projectId: 'project-28', projectRevision: 4 }));
	fixture.projectRevision = 6;
	fixture.imported = { sourceId: 'source-28', projectRevision: 6, proxyAttached: true };
	fixture.afterImportedInspection = () => { fixture.projectRevision = 7; };
	assert.equal(await fixture.broker.complete(OWNER, {
		claimId: CLAIM_ID, projectId: 'project-28', projectSchemaVersion: 28,
		binId: 'project-bin', sourceId: 'source-28', contentSha256: DIGEST,
		expectedProjectRevision: 4, committedProjectRevision: 6, success: true,
	}), false);
	await fixture.broker.dispose();
	assert.equal(await pending, false);
});

test('an uncompleted claim times out, releases, and can be retried', async () => {
	const callbacks: (() => void)[] = [];
	const fixture = createFixture({
		timeoutMs: 10,
		schedule: (callback) => { callbacks.push(callback); return callback; },
		cancelSchedule: () => undefined,
	});
	const first = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	assert.ok(fixture.broker.claim(OWNER, { projectId: 'project-1', projectRevision: 4 }));
	callbacks[0]!();
	assert.equal(await first, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID]);

	const second = fixture.broker.offer(offer());
	await fixture.locatorCreated(2);
	assert.equal(fixture.created, 2);
	await fixture.broker.dispose();
	assert.equal(await second, false);
});

test('restart recovery records an already-committed project-bin source without creating a locator', async () => {
	const fixture = createFixture({ alreadyImported: async () => true });
	assert.equal(await fixture.broker.offer(offer()), true);
	assert.equal(fixture.created, 0);
});

function createFixture(overrides: Partial<FramescaperNativeWatchImportBrokerOptions> = {}) {
	let projectRevision = 4;
	let ownerCurrent = true;
	let created = 0;
	const releases: string[] = [];
	const broker = new FramescaperNativeWatchImportBroker({
		currentOwner: () => ownerCurrent ? OWNER : null,
		isOwnerCurrent: (owner) => ownerCurrent && owner === OWNER,
		inspectProject: (projectId) => projectId === 'project-1' ? Object.freeze({
			schemaVersion: 20 as const, projectId, projectRevision, open: true, writable: true,
		}) : null,
		alreadyImported: async () => false,
		createLocator: async () => {
			created += 1;
			return Object.freeze({
				locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
				name: 'clip.mp4', size: 4, mimeType: 'video/mp4', lastModified: 10,
			});
		},
		releaseLocator: async (locator) => { releases.push(locator.locatorId); return true; },
		mintOpaqueId: () => CLAIM_ID,
		...overrides,
	});
	return {
		broker, releases,
		get created() { return created; },
		get projectRevision() { return projectRevision; },
		set projectRevision(value: number) { projectRevision = value; },
		set ownerCurrent(value: boolean) { ownerCurrent = value; },
		async locatorCreated(count = 1) {
			for (let attempt = 0; attempt < 20 && created < count; attempt += 1) await Promise.resolve();
			assert.equal(created, count);
		},
	};
}

function offer(importMode: 'link' | 'copy' = 'link') {
	return Object.freeze({
		rule: createWatchRuleV1({
			ruleId: '1'.repeat(32), grantId: '2'.repeat(32), projectId: 'project-1',
			extensions: ['mp4'], importMode, createdAtMs: 0,
		}),
		entry: Object.freeze({
			name: 'clip.mp4', fileIdentity: 'device-1-inode-2', sizeBytes: 4,
			modifiedAtMs: 10, isDirectory: false, symbolicLink: false,
		}),
		contentSha256: DIGEST,
	});
}

function createFixtureV28(schemaVersion: 28 | 31 = 28) {
	let projectRevision = 4;
	let created = 0;
	let imported: { sourceId: string; projectRevision: number; proxyAttached: boolean } | null = null;
	let afterImportedInspection: () => void = () => undefined;
	const releases: string[] = [];
	const broker = new FramescaperNativeWatchImportBroker({
		currentOwner: () => OWNER,
		isOwnerCurrent: (owner) => owner === OWNER,
		inspectProject: (projectId) => projectId === 'project-28' ? Object.freeze({
			schemaVersion, projectId, projectRevision, open: true, writable: true,
			binId: 'project-bin',
		}) : null,
		alreadyImported: async () => false,
		inspectImported: async () => {
			const result = imported === null ? null : Object.freeze({
				projectId: 'project-28', binId: 'project-bin', contentSha256: DIGEST,
				...imported,
			});
			afterImportedInspection();
			return result;
		},
		createLocator: async () => {
			created += 1;
			return Object.freeze({ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
				name: 'clip.mp4', size: 4, mimeType: 'video/mp4', lastModified: 10 });
		},
		releaseLocator: async (locator) => { releases.push(locator.locatorId); return true; },
		mintOpaqueId: () => CLAIM_ID,
	});
	return {
		broker, releases,
		get created() { return created; },
		get projectRevision() { return projectRevision; },
		set projectRevision(value: number) { projectRevision = value; },
		set imported(value: typeof imported) { imported = value; },
		set afterImportedInspection(value: () => void) { afterImportedInspection = value; },
		async locatorCreated() {
			for (let attempt = 0; attempt < 20 && created < 1; attempt += 1) await Promise.resolve();
			assert.equal(created, 1);
		},
	};
}

function offerV28() {
	return Object.freeze({
		rule: createWatchRuleV1({
			ruleId: '3'.repeat(32), grantId: '4'.repeat(32), projectId: 'project-28',
			binId: 'project-bin', extensions: ['mp4'], generateProxies: true, createdAtMs: 0,
		}),
		entry: Object.freeze({ name: 'clip.mp4', fileIdentity: 'device-28-inode-1', sizeBytes: 4,
			modifiedAtMs: 10, isDirectory: false, symbolicLink: false }),
		contentSha256: DIGEST,
	});
}
