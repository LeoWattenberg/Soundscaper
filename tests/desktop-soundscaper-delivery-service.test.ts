/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireSoundscaperDeliveryWriterLease,
	initializeSoundscaperDeliveryDatabase,
	releaseSoundscaperDeliveryWriterLease,
} from '../desktop/soundscaper-delivery-database.ts';
import { observeSoundscaperDeliveryRoot } from '../desktop/soundscaper-delivery-root.ts';
import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createSoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import {
	createSoundscaperDeliveryFilesystemFixture,
} from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('a V1 delivery survives service restart and publishes through a pathless claim', async (context) => {
	const fixture = await createFixture(context);
	let service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	assert.equal(claim?.jobId, queued.jobId);
	assert.equal(claim?.description.kind, 'soundscaper-delivery');
	assertPathless(claim);

	const opened = await service.beginWrite({
		claimId: claim!.claimId, fileName: 'master.wav', size: 4,
	});
	await service.writeChunk({ writeId: opened.writeId, offset: 0, bytes: new Uint8Array([1, 2]) });
	await service.close();

	service = await fixture.start();
	assert.deepEqual((await service.list()).entries.map(({ state }) => state), ['waiting-for-project']);
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), [], 'interrupted native stage is removed on restart');
	const second = await service.claimNext(authority(queuedDescription));
	assert.equal(second?.jobId, queued.jobId);
	const writer = await service.beginWrite({
		claimId: second!.claimId, fileName: 'master.wav', size: 4,
	});
	await service.writeChunk({
		writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]),
	});
	assert.deepEqual(await service.finishWrite(writer.writeId), { byteLength: 4 });
	const completed = await service.complete({
		claimId: second!.claimId,
		report: result(second!.description).report,
		currentAuthority: authority(second!.description), revalidateAuthority: () => authority(second!.description),
	});
	assert.equal(completed.state, 'completed');
	assert.deepEqual([...await readFile(join(fixture.outputRoot, 'master.wav'))], [1, 2, 3, 4]);
	assert.deepEqual(await readdir(fixture.outputRoot), ['master.wav']);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), [],
		'successful publication retires the native stage and leaves only the final file');
	assert.equal((await service.list()).entries[0]?.result?.publication.fileName, 'master.wav');
	await service.close();
});

test('restart cleanup is job-owned and publication never replaces an existing file', async (context) => {
	const fixture = await createFixture(context);
	await writeFile(join(fixture.outputRoot, 'unrelated.txt'), 'keep');
	let service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	let claim = await service.claimNext(authority(queuedDescription));
	let writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'master.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1]) });
	await service.close();
	assert.equal(await readFile(join(fixture.outputRoot, 'unrelated.txt'), 'utf8'), 'keep');

	service = await fixture.start();
	claim = await service.claimNext(authority(queuedDescription));
	writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'master.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await writeFile(join(fixture.outputRoot, 'master.wav'), 'someone else');
	await assert.rejects(
		service.complete({
			claimId: claim!.claimId, report: result(claim!.description).report,
			currentAuthority: authority(claim!.description), revalidateAuthority: () => authority(claim!.description),
		}),
		/already exists|replace/u,
	);
	assert.equal(await readFile(join(fixture.outputRoot, 'master.wav'), 'utf8'), 'someone else');
	assert.equal((await service.list()).entries[0]?.state, 'failed');
	await service.close();
});

test('root loss needs authorization and only the same physical directory can restore it', async (context) => {
	const fixture = await createFixture(context);
	const other = join(fixture.root, 'other');
	await import('node:fs/promises').then(({ mkdir }) => mkdir(other));
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	await service.revokeRoot(grant.grantId);
	assert.equal((await service.list()).entries[0]?.state, 'needs-authorization');
	await assert.rejects(service.reauthorizeRoot(grant.grantId, other), /same physical directory/u);
	await service.reauthorizeRoot(grant.grantId, fixture.outputRoot);
	assert.equal((await service.list({ currentProjectIdentity: authority(queuedDescription).projectIdentity })).entries[0]?.state, 'queued');
	await service.close();
});

test('pause, order, batch authority, events, cancellation, retry and report remain durable', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const first = batchDescription(grant.grantId, 'batch-01', 'member-01', 'First');
	const second = batchDescription(grant.grantId, 'batch-01', 'member-02', 'Second');
	const queued = await service.enqueueBatch({
		items: [first, second].map((descriptionValue, index) => ({
			description: descriptionValue,
			batch: {
				batchId: 'batch-01',
				member: {
					memberId: `member-0${index + 1}`, label: index === 0 ? 'First' : 'Second',
					presetId: `preset-member-0${index + 1}`, target: { kind: 'project' },
					mode: 'mix', settings: { format: 'wav' },
				},
			},
		})),
		admission: admission(first, second),
	});
	assert.deepEqual(queued.map(({ label, batchId }) => [label, batchId]), [
		['First', 'batch-01'], ['Second', 'batch-01'],
	]);
	service.pause();
	assert.equal(service.list().paused, true);
	assert.equal(await service.claimNext(authority(first)), null);
	service.resume();
	service.reorder(queued[1]!.jobId, 0);
	assert.deepEqual(service.list().entries.map(({ label }) => label), ['Second', 'First']);

	let claim = await service.claimNext(authority(second));
	service.updateProgress(claim!.claimId, 0.5);
	assert.throws(
		() => service.updateProgress(claim!.claimId, 0.2),
		/progress cannot move backwards/u,
	);
	service.updateProgress(claim!.claimId, 0.5);
	assert.equal(service.list().entries[0]?.progress, 0.5);
	await service.cancel(claim!.jobId);
	assert.equal(service.list().entries[0]?.state, 'cancelled');
	service.retry(claim!.jobId);
	claim = await service.claimNext(authority(second));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'second.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description, 4, undefined, 'second.wav').report,
		currentAuthority: authority(second), revalidateAuthority: () => authority(second),
	});
	const completed = service.list().entries[0]!;
	assert.equal(completed.state, 'completed');
	assert.equal(completed.result?.publication.fileName, 'second.wav');
	assert.deepEqual(completed.batchMember, {
		memberId: 'member-02', label: 'Second', presetId: 'preset-member-02',
		target: { kind: 'project' }, mode: 'mix', settings: { format: 'wav' },
	});

	const firstEvents = service.events({ afterSequence: 0, limit: 2 });
	assert.equal(firstEvents.events.length, 2);
	assert.equal(firstEvents.hasMore, true);
	const nextEvents = service.events({ afterSequence: firstEvents.nextSequence, limit: 1_000 });
	assert.ok(nextEvents.events.length > 0);
	assert.ok(nextEvents.events[0]!.sequence > firstEvents.events.at(-1)!.sequence);
	await service.close();
});

test('waiting is nonterminal, while final project or plan drift is permanently stale', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const anotherProject = {
		projectIdentity: { projectId: 'other-project', projectRevision: 1, projectSha256: 'b'.repeat(64) },
		planFingerprint: queuedDescription.planFingerprint,
	};
	assert.equal(service.list({ currentProjectIdentity: anotherProject.projectIdentity }).entries[0]?.state, 'waiting-for-project');
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'master.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description).report,
		currentAuthority: { ...authority(queuedDescription), planFingerprint: 'b'.repeat(64) },
		revalidateAuthority: () => authority(queuedDescription),
	}), /plan no longer matches|plan/iu);
	assert.equal(service.list().entries[0]?.state, 'stale');
	assert.deepEqual(await visibleDeliveryFiles(fixture.outputRoot), []);
	await service.close();
});

test('publication re-reads project identity and refuses a revision changed during rendering', async (context) => {
	const fixture = await createFixture(context);
	let persistedIdentity = description().projectIdentity;
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath: join(fixture.root, 'delivery.sqlite'),
		readProjectIdentity: async () => persistedIdentity,
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'master.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	persistedIdentity = Object.freeze({
		...persistedIdentity, projectRevision: 18, projectSha256: 'b'.repeat(64),
	});
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description).report,
		currentAuthority: authority(queuedDescription), revalidateAuthority: () => authority(queuedDescription),
	}), /project changed/u);
	assert.equal(service.list().entries[0]?.state, 'stale');
	assert.deepEqual(await visibleDeliveryFiles(fixture.outputRoot), []);
	await service.close();
});

test('publication revalidates project authority at the authenticated link boundary', async (context) => {
	const fixture = await createFixture(context);
	let authorityReads = 0;
	const original = description().projectIdentity;
	const changed = Object.freeze({ ...original, projectRevision: 18, projectSha256: 'b'.repeat(64) });
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath: join(fixture.root, 'delivery.sqlite'),
		readProjectIdentity: async () => (++authorityReads < 4 ? original : changed),
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'boundary.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId, report: result(claim!.description, 4, undefined, 'boundary.wav').report,
		currentAuthority: authority(queuedDescription), revalidateAuthority: () => authority(queuedDescription),
	}), /project changed/u);
	assert.equal(service.list().entries[0]?.state, 'stale');
	assert.equal(service.list().entries[0]?.lastFailureCode, 'stale-project');
	assert.equal((await readdir(fixture.outputRoot)).includes('boundary.wav'), false);
	await service.close();
});

test('publication preserves stale-plan at the final authenticated authority boundary', async (context) => {
	const fixture = await createFixture(context);
	const currentAuthority = {
		projectIdentity: description().projectIdentity,
		planFingerprint: '',
	};
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath: join(fixture.root, 'delivery.sqlite'),
		readProjectIdentity: async () => description().projectIdentity,
		beforeFileFence(operation) {
			if (operation === 'publication-authority') currentAuthority.planFingerprint = 'b'.repeat(64);
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	currentAuthority.projectIdentity = queuedDescription.projectIdentity;
	currentAuthority.planFingerprint = queuedDescription.planFingerprint;
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'plan-boundary.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description, 4, undefined, 'plan-boundary.wav').report,
		currentAuthority, revalidateAuthority: () => currentAuthority,
	}), /plan no longer matches/u);
	const stale = service.list().entries[0]!;
	assert.equal(stale.state, 'stale');
	assert.equal(stale.lastFailureCode, 'stale-plan');
	assert.equal((await readdir(fixture.outputRoot)).includes('plan-boundary.wav'), false);
	await service.close();
});

test('publication refuses sealed-byte tampering and a byte-identical foreign final', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	for (const [index, foreignFinal] of [false, true].entries()) {
		const queuedDescription = descriptionFor(grant.grantId);
		const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
		const claim = await service.claimNext(authority(queuedDescription));
		const fileName = `master-${String(index)}.wav`;
		const writer = await service.beginWrite({ claimId: claim!.claimId, fileName, size: 4 });
		await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
		await service.finishWrite(writer.writeId);
		const staging = (await readdir(fixture.privateStagingRoot))[0]!;
		if (foreignFinal) await writeFile(join(fixture.outputRoot, fileName), new Uint8Array([1, 2, 3, 4]));
		else await writeFile(join(fixture.privateStagingRoot, staging), new Uint8Array([9, 9, 9, 9]));
		await assert.rejects(service.complete({
			claimId: claim!.claimId, report: result(claim!.description, 4, undefined, fileName).report,
			currentAuthority: authority(queuedDescription), revalidateAuthority: () => authority(queuedDescription),
		}), foreignFinal ? /already exists|replace/u : /staging file changed|authenticated|native session changed/u);
		assert.equal(service.list().entries.find(({ jobId }) => jobId === queued.jobId)?.state, 'failed');
		if (foreignFinal) {
			assert.deepEqual([...await readFile(join(fixture.outputRoot, fileName))], [1, 2, 3, 4]);
			assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
		}
	}
	await service.close();
});

test('publication authenticates the linked inode and recovers a crash after link before journal phase', async (context) => {
	const fixture = await createFixture(context);
	let nowMs = 1_000;
	let takeoverDatabase: DatabaseSync | null = null;
	let takeoverLease: ReturnType<typeof acquireSoundscaperDeliveryWriterLease> | null = null;
	const databasePath = join(fixture.root, 'delivery.sqlite');
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath, now: () => nowMs, instanceId: 'first-instance', processId: 101,
		readProjectIdentity: async () => description().projectIdentity,
		beforeFileFence(operation) {
			if (operation !== 'publication-link' || takeoverDatabase) return;
			nowMs = 31_001;
			takeoverDatabase = new DatabaseSync(databasePath);
			initializeSoundscaperDeliveryDatabase(takeoverDatabase);
			takeoverLease = acquireSoundscaperDeliveryWriterLease(takeoverDatabase, {
				leaseId: 'second-lease', instanceId: 'second-instance', processId: 202, nowMs,
			});
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'linked.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId, report: result(claim!.description, 4, undefined, 'linked.wav').report,
		currentAuthority: authority(queuedDescription), revalidateAuthority: () => authority(queuedDescription),
	}), /fenced|taken over/u);
	assert.deepEqual(await readdir(fixture.outputRoot), ['linked.wav']);
	assert.equal((await readdir(fixture.privateStagingRoot)).length, 1);
	await service.close();
	releaseSoundscaperDeliveryWriterLease(takeoverDatabase!, takeoverLease!);
	takeoverDatabase!.close();
	const recovered = await fixture.start();
	const completed = recovered.list().entries[0]!;
	assert.equal(completed.state, 'completed');
	assert.deepEqual(await readdir(fixture.outputRoot), ['linked.wav']);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	await recovered.close();
});

test('tampering after the final staging inspection cannot publish changed bytes', async (context) => {
	const fixture = await createFixture(context);
	let stagingPath = '';
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath: join(fixture.root, 'delivery.sqlite'),
		readProjectIdentity: async () => description().projectIdentity,
		beforeFileFence(operation) {
			if (operation === 'publication-ready') writeFileSync(stagingPath, new Uint8Array([9, 9, 9, 9]));
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'race.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	stagingPath = join(fixture.privateStagingRoot, (await readdir(fixture.privateStagingRoot))[0]!);
	await assert.rejects(service.complete({
		claimId: claim!.claimId, report: result(claim!.description, 4, undefined, 'race.wav').report,
		currentAuthority: authority(queuedDescription), revalidateAuthority: () => authority(queuedDescription),
	}), /changed|authenticated|different sealed artifact/u);
	assert.equal((await readdir(fixture.outputRoot)).includes('race.wav'), false);
	assert.equal(service.list().entries[0]?.state, 'failed');
	await service.close();
});

test('cancel, fail, and reauthorization retire only their exact native sessions', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);

	async function staged(index: number) {
		const queuedDescription = descriptionFor(grant.grantId);
		const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
		const claim = await service.claimNext(authority(queuedDescription));
		const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: `owned-${String(index)}.wav`, size: 4 });
		await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
		await service.finishWrite(writer.writeId);
		assert.equal((await readdir(fixture.privateStagingRoot)).length, 1);
		assert.deepEqual(await readdir(fixture.outputRoot), []);
		return { claim: claim!, jobId: queued.jobId };
	}

	const cancelled = await staged(1);
	await service.cancel(cancelled.jobId);
	assert.equal(service.list().entries.find(({ jobId }) => jobId === cancelled.jobId)?.state, 'cancelled');
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	const failed = await staged(2);
	await service.fail(failed.claim.claimId, 'render-failed');
	assert.equal(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.lastFailureCode, 'render-failed');
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	const reauthorized = await staged(3);
	await service.revokeRoot(grant.grantId);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	await service.reauthorizeRoot(grant.grantId, fixture.outputRoot);
	assert.equal(service.list().entries.find(({ jobId }) => jobId === reauthorized.jobId)?.state, 'waiting-for-project');
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	await service.close();
});

test('native staging never appears in the user destination before publication', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'cleanup-race.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	assert.equal((await readdir(fixture.privateStagingRoot)).length, 1);
	await service.cancel(queued.jobId);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	await service.close();
});

test('lease loss during an active write leaves successor recovery intact and close still releases resources', async (context) => {
	const fixture = await createFixture(context);
	let nowMs = 1_000;
	let takeoverDatabase: DatabaseSync | null = null;
	let takeoverLease: ReturnType<typeof acquireSoundscaperDeliveryWriterLease> | null = null;
	const databasePath = join(fixture.root, 'delivery.sqlite');
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath, now: () => nowMs, instanceId: 'active-first', processId: 101,
		readProjectIdentity: async () => description().projectIdentity,
		beforeFileFence(operation) {
			if (operation !== 'write' || takeoverDatabase) return;
			nowMs = 31_001;
			takeoverDatabase = new DatabaseSync(databasePath);
			initializeSoundscaperDeliveryDatabase(takeoverDatabase);
			takeoverLease = acquireSoundscaperDeliveryWriterLease(takeoverDatabase, {
				leaseId: 'active-second', instanceId: 'active-successor', processId: 202, nowMs,
			});
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'active.wav', size: 4 });
	await assert.rejects(service.writeChunk({
		writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2]),
	}), /fenced|taken over/u);
	const partial = (await readdir(fixture.privateStagingRoot))[0]!;
	await service.close();
	assert.ok((await readdir(fixture.privateStagingRoot)).includes(partial),
		'the fenced owner leaves only its opaque private recovery state');
	releaseSoundscaperDeliveryWriterLease(takeoverDatabase!, takeoverLease!);
	takeoverDatabase!.close();
	const recovered = await fixture.start();
	assert.equal(recovered.list().entries[0]?.state, 'waiting-for-project');
	assert.equal((await readdir(fixture.privateStagingRoot)).includes(partial), false);
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	await recovered.close();
});

test('a lease takeover during awaited root observation fences the stale writer before DB mutation', async (context) => {
	const fixture = await createFixture(context);
	const observed = await observeSoundscaperDeliveryRoot(fixture.outputRoot);
	let releaseObservation!: () => void;
	const waiting = new Promise<void>((resolve) => { releaseObservation = resolve; });
	let nowMs = 1_000;
	const databasePath = join(fixture.root, 'delivery.sqlite');
	const service = await SoundscaperDeliveryService.start({
		filesystem: fixture.filesystem,
		databasePath,
		instanceId: 'instance-first', processId: 101, now: () => nowMs,
		readProjectIdentity: async () => null,
		observeRoot: async () => { await waiting; return observed; },
	});
	const pending = service.authorizeRoot(fixture.outputRoot);
	nowMs = 31_001;
	const database = new DatabaseSync(databasePath);
	initializeSoundscaperDeliveryDatabase(database);
	const takeover = acquireSoundscaperDeliveryWriterLease(database, {
		leaseId: 'lease-second', instanceId: 'instance-second', processId: 202, nowMs,
	});
	releaseObservation();
	await assert.rejects(pending, /fenced|taken over/u);
	assert.equal(Number((database.prepare('SELECT COUNT(*) AS count FROM delivery_roots').get() as Record<string, unknown>).count), 0);
	await service.close();
	releaseSoundscaperDeliveryWriterLease(database, takeover);
	database.close();
});

function descriptionFor(destinationGrantId: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', sampleRate: 48_000 },
			exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
		}),
	});
}

function authority(value: ReturnType<typeof descriptionFor>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity,
		planFingerprint: value.planFingerprint,
	});
}

function admission(...values: ReturnType<typeof descriptionFor>[]) {
	return Object.freeze({
		projectIdentity: values[0]!.projectIdentity,
		planFingerprints: Object.freeze(values.map(({ planFingerprint }) => planFingerprint)),
		saved: true as const, clean: true as const, named: true as const,
	});
}

function batchDescription(
	destinationGrantId: string,
	batchId: string,
	memberId: string,
	label: string,
) {
	return createSoundscaperDeliveryDescriptionV1({
		label,
		projectIdentity: description().projectIdentity,
		destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav' },
			exportPlan: { format: 'wav', memberId, projectRevision: 17 },
			batch: { batchId, memberId, presetId: `preset-${memberId}`, target: { kind: 'project' }, mode: 'mix' },
		}),
	});
}

async function createFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-'));
	const outputRoot = join(root, 'outputs');
	const privateStagingRoot = join(root, 'private-staging');
	await import('node:fs/promises').then(({ mkdir }) => mkdir(outputRoot));
	const filesystem = createSoundscaperDeliveryFilesystemFixture(privateStagingRoot);
	context.after(async () => {
		await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
	});
	return {
		root,
		outputRoot,
		privateStagingRoot,
		filesystem,
		start: () => SoundscaperDeliveryService.start({
			databasePath: join(root, 'delivery.sqlite'),
			readProjectIdentity: async (projectId: string) => projectId === 'album-project'
				? { projectId, projectRevision: 17, projectSha256: 'a'.repeat(64) }
				: null,
			filesystem,
		}),
	};
}

function assertPathless(value: unknown): void {
	const encoded = JSON.stringify(value);
	assert.doesNotMatch(encoded, /rootPath|stagingPath|absolutePath/u);
	assert.doesNotMatch(encoded, /soundscaper-delivery-/u);
}

async function visibleDeliveryFiles(root: string): Promise<string[]> {
	return readdir(root);
}
