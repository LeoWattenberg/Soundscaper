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
const IDENTITY = Object.freeze({
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
});

test('a Framescaper v1 linked claim stays pathless through durable acknowledgement', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	const claim = fixture.broker.claim(OWNER, claimRequest());
	assert.deepEqual(claim, {
		...IDENTITY, claimId: CLAIM_ID, projectId: 'project-1', projectRevision: 4,
		binId: 'project-bin', generateProxies: false, existingSourceId: null,
		importMode: 'link', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		name: 'clip.mp4', size: 4, mimeType: 'video/mp4', lastModified: 10,
		contentSha256: DIGEST,
	});
	assert.equal(JSON.stringify(claim).includes('/watched'), false);
	fixture.projectRevision = 5;
	fixture.imported = { sourceId: 'source-1', projectRevision: 5, proxyAttached: false };
	const completion = completionRequest({ sourceId: 'source-1', committedProjectRevision: 5 });
	assert.equal(await fixture.broker.complete(OWNER, completion), true);
	assert.equal(await fixture.broker.complete(OWNER, completion), true, 'completion is idempotent');
	assert.equal(await pending, true);
	assert.equal(fixture.releases.length, 0, 'committed link is project-owned');
	assert.equal(fixture.broker.recorded(offer()), true);
	assert.equal(await fixture.broker.offer(offer()), true, 'restart cannot duplicate the imported source');
	assert.equal(fixture.created, 1);
	await fixture.broker.dispose();
});

test('copy and failed v1 claims release their temporary linked locators', async () => {
	const copied = createFixture();
	const copyPending = copied.broker.offer(offer({ importMode: 'copy' }));
	await copied.locatorCreated();
	assert.ok(copied.broker.claim(OWNER, claimRequest()));
	copied.projectRevision = 5;
	copied.imported = { sourceId: 'source-copy', projectRevision: 5, proxyAttached: false };
	assert.equal(await copied.broker.complete(OWNER, completionRequest({
		sourceId: 'source-copy', committedProjectRevision: 5,
	})), true);
	assert.equal(await copyPending, true);
	assert.deepEqual(copied.releases, [LOCATOR_ID]);

	const failed = createFixture();
	const failedPending = failed.broker.offer(offer());
	await failed.locatorCreated();
	assert.ok(failed.broker.claim(OWNER, claimRequest()));
	assert.equal(await failed.broker.complete(OWNER, completionRequest({
		success: false, sourceId: null, committedProjectRevision: 4,
	})), true);
	assert.equal(await failedPending, false);
	assert.deepEqual(failed.releases, [LOCATOR_ID]);
});

test('v1 claims fail closed for stale owners, revisions, and foreign identities', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	assert.equal(fixture.broker.claim({}, claimRequest()), null);
	assert.equal(fixture.broker.claim(OWNER, claimRequest({ projectRevision: 3 })), null);
	fixture.projectRevision = 5;
	assert.equal(fixture.broker.claim(OWNER, claimRequest()), null);
	assert.throws(() => fixture.broker.claim(OWNER, {
		...claimRequest(), schemaFamily: 'soundscaper',
	}), /foreign|Framescaper/iu);
	await fixture.broker.dispose();
	assert.equal(await pending, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID]);
});

test('v1 proxy claims bind the exact target bin through digest-bound completion', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer({ generateProxies: true }));
	await fixture.locatorCreated();
	const claim = fixture.broker.claim(OWNER, claimRequest());
	assert.equal(claim?.schemaFamily, 'framescaper');
	assert.equal(claim?.schemaVersion, 1);
	assert.equal(claim?.binId, 'project-bin');
	assert.equal(claim?.generateProxies, true);
	fixture.projectRevision = 6;
	fixture.imported = { sourceId: 'source-proxy', projectRevision: 6, proxyAttached: true };
	const completion = completionRequest({
		sourceId: 'source-proxy', committedProjectRevision: 6,
	});
	assert.equal(await fixture.broker.complete(OWNER, completion), true);
	assert.equal(await pending, true);
	assert.equal(fixture.broker.recorded(offer({ generateProxies: true })), true);
	assert.deepEqual(fixture.releases, []);
});

test('v1 restart resumes a missing proxy without duplicating the imported digest', async () => {
	const fixture = createFixture();
	fixture.imported = { sourceId: 'source-existing', projectRevision: 4, proxyAttached: false };
	const pending = fixture.broker.offer(offer({ generateProxies: true }));
	await fixture.locatorCreated();
	assert.equal(fixture.broker.claim(OWNER, claimRequest())?.existingSourceId, 'source-existing');
	await fixture.broker.dispose();
	assert.equal(await pending, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID]);

	const complete = createFixture();
	complete.imported = { sourceId: 'source-existing', projectRevision: 4, proxyAttached: true };
	assert.equal(await complete.broker.offer(offer({ generateProxies: true })), true);
	assert.equal(complete.created, 0);
});

test('v1 completion rechecks project identity after async digest inspection', async () => {
	const fixture = createFixture();
	const pending = fixture.broker.offer(offer({ generateProxies: true }));
	await fixture.locatorCreated();
	assert.ok(fixture.broker.claim(OWNER, claimRequest()));
	fixture.projectRevision = 6;
	fixture.imported = { sourceId: 'source-proxy', projectRevision: 6, proxyAttached: true };
	fixture.afterImportedInspection = () => { fixture.projectRevision = 7; };
	assert.equal(await fixture.broker.complete(OWNER, completionRequest({
		sourceId: 'source-proxy', committedProjectRevision: 6,
	})), false);
	await fixture.broker.dispose();
	assert.equal(await pending, false);
});

test('an uncompleted v1 claim times out, releases, and can be retried', async () => {
	const callbacks: Array<() => void> = [];
	const fixture = createFixture({
		timeoutMs: 10,
		schedule: (callback) => { callbacks.push(callback); return callback; },
		cancelSchedule: () => undefined,
	});
	const first = fixture.broker.offer(offer());
	await fixture.locatorCreated();
	assert.ok(fixture.broker.claim(OWNER, claimRequest()));
	callbacks[0]!();
	assert.equal(await first, false);
	assert.deepEqual(fixture.releases, [LOCATOR_ID]);
	const second = fixture.broker.offer(offer());
	await fixture.locatorCreated(2);
	await fixture.broker.dispose();
	assert.equal(await second, false);
});

test('restart recovery records an already-committed v1 source without creating a locator', async () => {
	const fixture = createFixture();
	fixture.imported = { sourceId: 'source-existing', projectRevision: 4, proxyAttached: false };
	assert.equal(await fixture.broker.offer(offer()), true);
	assert.equal(fixture.created, 0);
});

interface ImportedState {
	readonly sourceId: string;
	readonly projectRevision: number;
	readonly proxyAttached: boolean;
}

function createFixture(overrides: Partial<FramescaperNativeWatchImportBrokerOptions> = {}) {
	let projectRevision = 4;
	let ownerCurrent = true;
	let created = 0;
	let imported: ImportedState | null = null;
	let afterImportedInspection: () => void = () => undefined;
	const releases: string[] = [];
	const broker = new FramescaperNativeWatchImportBroker({
		currentOwner: () => ownerCurrent ? OWNER : null,
		isOwnerCurrent: (owner) => ownerCurrent && owner === OWNER,
		inspectProject: (projectId) => projectId === 'project-1' ? Object.freeze({
			...IDENTITY, projectId, projectRevision, open: true, writable: true,
			binId: 'project-bin' as const,
		}) : null,
		inspectImported: async () => {
			const result = imported === null ? null : Object.freeze({
				...IDENTITY, projectId: 'project-1', binId: 'project-bin' as const,
				contentSha256: DIGEST, ...imported,
			});
			afterImportedInspection();
			return result;
		},
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
		set imported(value: ImportedState | null) { imported = value; },
		set afterImportedInspection(value: () => void) { afterImportedInspection = value; },
		async locatorCreated(count = 1) {
			for (let attempt = 0; attempt < 20 && created < count; attempt += 1) await Promise.resolve();
			assert.equal(created, count);
		},
	};
}

function offer(options: Readonly<{
	importMode?: 'link' | 'copy';
	generateProxies?: boolean;
}> = {}) {
	return Object.freeze({
		rule: createWatchRuleV1({
			...IDENTITY,
			ruleId: '1'.repeat(32), grantId: '2'.repeat(32), projectId: 'project-1',
			binId: 'project-bin', extensions: ['mp4'], importMode: options.importMode ?? 'link',
			generateProxies: options.generateProxies ?? false, createdAtMs: 0,
		}),
		entry: Object.freeze({
			name: 'clip.mp4', fileIdentity: 'device-1-inode-2', sizeBytes: 4,
			modifiedAtMs: 10, isDirectory: false, symbolicLink: false,
		}),
		contentSha256: DIGEST,
	});
}

function claimRequest(overrides: Readonly<{ projectRevision?: number }> = {}) {
	return Object.freeze({
		...IDENTITY, projectId: 'project-1', projectRevision: overrides.projectRevision ?? 4,
	});
}

function completionRequest(overrides: Readonly<{
	sourceId: string | null;
	committedProjectRevision: number;
	success?: boolean;
}>) {
	return Object.freeze({
		...IDENTITY, claimId: CLAIM_ID, projectId: 'project-1', binId: 'project-bin' as const,
		sourceId: overrides.sourceId, contentSha256: DIGEST, expectedProjectRevision: 4,
		committedProjectRevision: overrides.committedProjectRevision,
		success: overrides.success ?? true,
	});
}
