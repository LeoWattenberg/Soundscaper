/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import type {
	FramescaperProjectV18ClaimCleanupResult,
} from '../src/framescaper/editor-project-v18-claim-cleanup-repository.ts';
import {
	bodyRow,
	type ClaimCleanupFixture,
	claim,
	createClaimCleanupFixture,
	emptyScope,
	LIVE_GRACE,
	mediaRow,
	PROJECT_ID,
	PROXY_KEY,
	PROXY_SHA,
	seedBodiesAndClaims,
	SOURCE_ID,
	stagingRecord,
	tombstones,
} from './helpers/framescaper-v18-claim-cleanup-fixture.ts';

const BODY_BYTES = Uint8Array.of(1, 2, 3, 4);
const RACE_SHA = bytesToHex(sha256(BODY_BYTES));
const RACE_KEY = `video-proxy-sha256:${RACE_SHA}`;
const RACE_PATH = `proxy/${RACE_SHA}.bin`;

interface RacedReconcile {
	observed: boolean;
	settled: Promise<Readonly<FramescaperProjectV18ClaimCleanupResult> | null>;
}

test('a renewed claim lease keeps an unrooted staged body out of routine reclamation', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'live-operation', 'live');
	fixture.files.set(String(item.rowIdentity.path), new Blob([BODY_BYTES]));
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: item }]);

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, []);
	assert.deepEqual(result.issues, []);
	assert.notEqual(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.deepEqual(await stagingRecord(fixture.database, item.key), item);
	assert.deepEqual(await tombstones(fixture.database), []);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), true);
});

test('the staged body grace keeps a lapsed claim out of routine reclamation', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'graced-operation');
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy', undefined, LIVE_GRACE), claim: item },
	]);

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, []);
	assert.deepEqual(result.issues, []);
	assert.notEqual(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.deepEqual(await stagingRecord(fixture.database, item.key), item);
});

test('a lapsed lease and lapsed grace still reclaim the orphaned unrooted body', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'orphan-operation');
	fixture.files.set(String(item.rowIdentity.path), new Blob([BODY_BYTES]));
	await seedBodiesAndClaims(fixture.database, [{ row: bodyRow('proxy'), claim: item }]);

	const result = await fixture.repository.reconcile(emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, [PROXY_KEY]);
	assert.equal(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.equal(await stagingRecord(fixture.database, item.key), undefined);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), false);
});

test('the owning operation still releases its own live claim inventory', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	const item = claim('proxy', PROXY_KEY, PROXY_SHA, 'released-operation', 'live');
	fixture.files.set(String(item.rowIdentity.path), new Blob([BODY_BYTES]));
	await seedBodiesAndClaims(fixture.database, [
		{ row: bodyRow('proxy', undefined, LIVE_GRACE), claim: item },
	]);

	const result = await fixture.repository.cleanupOperation({
		operationId: item.operationId,
		projectId: item.projectId,
		sourceId: item.sourceId,
		baseFingerprint: item.baseFingerprint,
	}, emptyScope());

	assert.equal(result.status, 'settled');
	assert.deepEqual(result.cleanedBodyKeys, [PROXY_KEY]);
	assert.equal(await mediaRow(fixture.database, PROXY_KEY), undefined);
	assert.equal(await stagingRecord(fixture.database, item.key), undefined);
	assert.equal(fixture.files.has(String(item.rowIdentity.path)), false);
});

test('routine reclamation cannot detach a body while its claim is being verified', async (context) => {
	const fixture = await createClaimCleanupFixture(context);
	fixture.files.set(RACE_PATH, new Blob([BODY_BYTES]));
	await transact(fixture.database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => {
		mediaAssets.put(raceBodyRow());
	});
	const raced = reconcileDuringVerification(fixture);

	const verified = await fixture.staging.createVerifiedClaim({
		operationId: 'race-operation', projectId: PROJECT_ID, sourceId: SOURCE_ID,
		baseFingerprint: 'ab'.repeat(32), bodyKind: 'proxy', bodyKey: RACE_KEY,
		byteLength: BODY_BYTES.byteLength, mimeType: 'video/mp4',
	});
	const result = await raced.settled;

	assert.equal(raced.observed, true);
	assert.equal(verified.status, 'verified');
	assert.equal(result?.status, 'settled');
	assert.deepEqual(result?.cleanedBodyKeys, []);
	assert.deepEqual(await stagingRecord(fixture.database, verified.key), verified);
	assert.notEqual(await mediaRow(fixture.database, RACE_KEY), undefined);
	assert.equal(fixture.files.has(RACE_PATH), true);
});

/** The armed sweep fires on the second body-row read, when the claim exists and its body is still being hashed. */
function reconcileDuringVerification(fixture: ClaimCleanupFixture): RacedReconcile {
	const state: RacedReconcile = { observed: false, settled: Promise.resolve(null) };
	let reads = 0;
	const observe = (): void => {
		fixture.indexedDB.onNextGetForStore('mediaAssets', () => {
			reads += 1;
			if (reads < 2) { observe(); return; }
			state.observed = true;
			state.settled = fixture.repository.reconcile(emptyScope());
		});
	};
	observe();
	return state;
}

function raceBodyRow(): Record<string, unknown> {
	return {
		sourceId: RACE_KEY,
		kind: 'video-proxy',
		encoding: 'video-proxy-v1',
		storage: 'opfs',
		path: RACE_PATH,
		mediaContentDigestVersion: 1,
		mediaContentToken: 'media-content-race-0000000000000001',
		sha256: RACE_SHA,
		size: BODY_BYTES.byteLength,
		mimeType: 'video/mp4',
		committedAt: '2026-08-12T15:00:00.000Z',
		pendingProjectUntil: LIVE_GRACE,
	};
}
