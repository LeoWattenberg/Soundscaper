/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireSoundscaperDeliveryWriterLease,
	initializeSoundscaperDeliveryDatabase,
	releaseSoundscaperDeliveryWriterLease,
} from '../desktop/soundscaper-delivery-database.ts';
import { SoundscaperDeliveryQueueRepository } from '../desktop/soundscaper-delivery-queue-repository.ts';
import { SoundscaperDeliveryRootStore } from '../desktop/soundscaper-delivery-root.ts';
import { createSoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { PROJECT, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';

const JOB = 'a'.repeat(48);
const SECOND_JOB = 'b'.repeat(48);
const CLAIM = 'c'.repeat(48);

test('delivery mutations retain their last timestamp when the wall clock moves backwards', context => {
	const fixture = createFixture(context);
	const { repository, description } = fixture;
	repository.insert([
		{ jobId: JOB, description, batch: null },
		{ jobId: SECOND_JOB, description, batch: null },
	]);
	fixture.setNow(1_001);
	assert.equal(repository.claim(JOB, CLAIM), true);
	assertTimestamp(fixture.database, JOB, 1_001);
	fixture.setNow(999);

	repository.progress(JOB, 0.25);
	repository.prepareWrite(JOB, 'private-stage', 'master.wav');
	repository.authenticateWrite(JOB, 'volume', 'file', 'recovery');
	repository.clearStaging(JOB);
	repository.prepareWrite(JOB, 'private-stage', 'master.wav');
	repository.authenticateWrite(JOB, 'volume', 'file', 'recovery');
	repository.sealWrite(JOB, 4, 'd'.repeat(64));
	repository.settleFailed(JOB, 'render-failed', result(description).report);
	assert.equal(repository.attemptReports(JOB).length, 1);
	repository.setState(JOB, 'queued', null);
	assert.equal(repository.claim(JOB, CLAIM), true);
	repository.progress(JOB, 0.5);
	repository.prepareWrite(JOB, 'private-stage', 'master.wav');
	repository.authenticateWrite(JOB, 'volume', 'file', 'recovery');
	repository.sealWrite(JOB, 4, 'd'.repeat(64));
	repository.reorder(repository.rows('1 = 1'), SECOND_JOB, 0);
	assert.equal(repository.row(SECOND_JOB).position, 0);
	assertTimestamp(fixture.database, SECOND_JOB, 1_000);
	repository.discardJournalAndSetState(SECOND_JOB, 'cancelled', null);

	const completed = result(description);
	repository.preparePublication(repository.row(JOB), completed);
	repository.markPublished(JOB);
	repository.settleCompleted(JOB, completed);
	assert.equal(repository.row(JOB).state, 'completed');
	assert.equal(repository.row(SECOND_JOB).state, 'cancelled');
	assert.equal(repository.journal(JOB), undefined);
	assert.equal(repository.attemptReports(JOB).length, 2);
	assertTimestamp(fixture.database, JOB, 1_001);
	assertTimestamp(fixture.database, SECOND_JOB, 1_000);
	const events = repository.events(0, 100);
	assert.ok(events.length > 10);
	assert.deepEqual(events.map(({ sequence }) => sequence), events.map((_, index) => index + 1));
	assert.equal(events.at(-1)?.createdAtMs, 999, 'lease/event clocks retain actual wall time');

	fixture.setNow(1_100);
	repository.reorder(repository.rows('1 = 1'), JOB, 0);
	assertTimestamp(fixture.database, JOB, 1_100);
	assertTimestamp(fixture.database, SECOND_JOB, 1_100);
});

test('timestamp protection preserves expired and replaced delivery writer refusals', context => {
	const fixture = createFixture(context);
	const { repository, description, database, lease } = fixture;
	repository.insert([{ jobId: JOB, description, batch: null }]);
	assert.equal(repository.claim(JOB, CLAIM), true);
	const eventsBefore = repository.events(0, 100);
	fixture.setNow(lease.expiresAtMs + 1);
	assert.throws(() => repository.progress(JOB, 0.5), /lease expired/u);
	assert.equal(repository.row(JOB).progress, 0);
	assert.deepEqual(repository.events(0, 100), eventsBefore);
	const successor = acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'successor-lease', instanceId: 'successor-instance', processId: 202,
		nowMs: lease.expiresAtMs + 1,
	});
	fixture.setNow(999);
	assert.throws(() => repository.setState(JOB, 'cancelled', null), /fenced/u);
	assert.equal(repository.row(JOB).state, 'running');
	assert.deepEqual(repository.events(0, 100), eventsBefore);
	assertTimestamp(database, JOB, 1_000);
	assert.equal(releaseSoundscaperDeliveryWriterLease(database, lease), false);
	assert.equal(releaseSoundscaperDeliveryWriterLease(database, successor), true);
});

test('delivery root authorization can be revoked after a backwards wall clock step', async context => {
	const fixture = createFixture(context);
	const grant = fixture.roots.require(fixture.description.destinationGrantId);
	fixture.setNow(999);
	assert.equal(fixture.roots.revoke(grant.grantId, 999), true);
	assert.equal(fixture.roots.require(grant.grantId).revokedAtMs, 1_000);
	assert.equal(await fixture.roots.revalidate(fixture.roots.require(grant.grantId)), false);
	assert.equal(fixture.roots.revoke(grant.grantId, 999), false);
});

test('reopened delivery rows retain their timestamp across clock rollback and advance normally later', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-rollback-'));
	const databases: DatabaseSync[] = [];
	context.after(async () => {
		for (const database of databases) if (database.isOpen) database.close();
		await rm(directory, { recursive: true, force: true });
	});
	const path = join(directory, 'delivery.sqlite');
	const first = createFixture(context, path);
	databases.push(first.database);
	first.repository.insert([{ jobId: JOB, description: first.description, batch: null }]);
	first.setNow(1_100);
	assert.equal(first.repository.claim(JOB, CLAIM), true);
	first.repository.setState(JOB, 'queued', null);
	assertTimestamp(first.database, JOB, 1_100);
	assert.equal(releaseSoundscaperDeliveryWriterLease(first.database, first.lease), true);
	first.database.close();

	const second = createFixture(context, path, 900);
	databases.push(second.database);
	assert.equal(second.repository.claim(JOB, CLAIM), true);
	second.repository.progress(JOB, 0.5);
	assertTimestamp(second.database, JOB, 1_100);
	second.setNow(1_200);
	second.repository.progress(JOB, 0.75);
	assertTimestamp(second.database, JOB, 1_200);
	const eventsBefore = second.repository.events(0, 100);
	assert.throws(() => second.repository.progress(JOB, 0.25), /cannot move backwards/u);
	assert.equal(second.repository.row(JOB).progress, 0.75);
	assertTimestamp(second.database, JOB, 1_200);
	assert.deepEqual(second.repository.events(0, 100), eventsBefore);
});

function createFixture(context: test.TestContext, path = ':memory:', initialNow = 1_000) {
	const database = new DatabaseSync(path);
	context.after(() => { if (database.isOpen) database.close(); });
	initializeSoundscaperDeliveryDatabase(database);
	let now = initialNow;
	const lease = acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'writer-lease', instanceId: 'writer-instance', processId: 101, nowMs: now,
	});
	const roots = new SoundscaperDeliveryRootStore(database);
	const grant = roots.authorize({
		canonicalPath: '/private-test-output', volumeIdentity: 'volume', directoryIdentity: 'directory',
	}, now);
	const description = createSoundscaperDeliveryDescriptionV1({
		label: 'Clock rollback', projectIdentity: PROJECT, destinationGrantId: grant.grantId,
		plan: { format: 'wav', sampleRate: 48_000 },
	});
	const repository = new SoundscaperDeliveryQueueRepository(database, () => lease, () => now);
	return { database, lease, roots, repository, description, setNow: (value: number) => { now = value; } };
}

function assertTimestamp(database: DatabaseSync, jobId: string, updated: number): void {
	const row = database.prepare('SELECT created_at_ms, updated_at_ms FROM delivery_queue WHERE job_id = ?')
		.get(jobId) as Readonly<{ created_at_ms: number; updated_at_ms: number }>;
	assert.equal(row.created_at_ms, 1_000);
	assert.equal(row.updated_at_ms, updated);
}
