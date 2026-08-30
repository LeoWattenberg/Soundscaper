/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
	SoundscaperDeliveryContractError,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import {
	createSoundscaperDeliveryFilesystemFixture,
} from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('an invalid write declaration is refused before creating any filesystem artifact', async (context) => {
	const fixture = await createFixture(context);
	let filesystemReached = false;
	const service = await fixture.start({ beforeFileFence: () => { filesystemReached = true; } });
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	filesystemReached = false;
	await assert.rejects(
		service.beginWrite({
			claimId: claim!.claimId, fileName: 'invalid.wav', size: 4, finalPrefixByteLength: 7,
		}),
		/final prefix|invalid/iu,
	);
	assert.equal(filesystemReached, false);
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	await service.close();
});

test('null queue batch authority cannot discard a batch sealed inside the exact plan', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = batchDescription(grant.grantId, 'batch-null', 'member-null');
	await assert.rejects(
		service.enqueue(queuedDescription, null, admission(queuedDescription)),
		/batch authority.*null|batch.*match/iu,
	);
	assert.deepEqual(service.list().entries, []);
	await service.close();
});

test('batch admission closes, bounds, and exactly compares every member field to its sealed plan', async (context) => {
	const fixture = await createFixture(context);
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = batchDescription(grant.grantId, 'batch-exact', 'member-exact');
	const exact = {
		memberId: 'member-exact', label: 'Batch member', presetId: 'preset-member-exact',
		target: { kind: 'project' }, mode: 'mix', settings: { format: 'wav' },
	};
	const invalid = [
		{ ...exact, label: 'Other label' },
		{ ...exact, presetId: 'other-preset' },
		{ ...exact, target: { kind: 'selection' } },
		{ ...exact, mode: 'stems' },
		{ ...exact, settings: { format: 'flac' } },
		{ ...exact, unsupported: true },
		{ ...exact, settings: { format: 'wav', nested: nested(80) } },
		{ ...exact, settings: { format: 'wav', oversized: 'x'.repeat(2 * 1024 * 1024) } },
	];
	for (const member of invalid) {
		await assert.rejects(service.enqueue(
			queuedDescription,
			{ batchId: 'batch-exact', member },
			admission(queuedDescription),
		), /batch|bounded|canonical|sealed|unsupported/iu);
	}
	assert.deepEqual(service.list().entries, []);
	await service.close();
});

test('authenticated native cleanup never interprets or unlinks a foreign destination leaf', async (context) => {
	const fixture = await createFixture(context);
	const foreignPath = join(fixture.outputRoot, '.soundscaper-foreign.partial');
	await writeFile(foreignPath, new Uint8Array([9, 9, 9, 9]));
	const service = await fixture.start();
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'late-race.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await service.cancel(queued.jobId);
	assert.deepEqual([...await readFile(foreignPath)], [9, 9, 9, 9]);
	assert.deepEqual(await readdir(fixture.outputRoot), ['.soundscaper-foreign.partial']);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	await service.close();
});

test('transient project-authority read failure is never recorded as permanent staleness', async (context) => {
	const fixture = await createFixture(context);
	let reads = 0;
	const service = await fixture.start({
		readProjectIdentity: async () => {
			reads += 1;
			if (reads === 3) throw new Error('transient authority read failure');
			return description().projectIdentity;
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'transient.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description, 4, undefined, 'transient.wav').report,
		currentAuthority: authority(queuedDescription),
		revalidateAuthority: () => authority(queuedDescription),
	}), /transient authority read failure/u);
	assert.equal(service.list().entries[0]?.state, 'running');
	await service.fail(claim!.claimId, 'authority-read-failed');
	assert.equal(service.list().entries[0]?.state, 'failed');
	service.retry(service.list().entries[0]!.jobId);
	assert.equal(service.list().entries[0]?.state, 'waiting-for-project');
	await service.close();
});

test('fresh owner authority is required inside the final publication fence', async (context) => {
	const fixture = await createFixture(context);
	let publicationFenceReached = false;
	let finalAuthorityReads = 0;
	const service = await fixture.start({
		beforeFileFence: (operation) => {
			if (operation === 'publication-authority') publicationFenceReached = true;
		},
	});
	const grant = await service.authorizeRoot(fixture.outputRoot);
	const queuedDescription = descriptionFor(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({
		claimId: claim!.claimId, fileName: 'owner-switch.wav', size: 4,
	});
	await service.writeChunk({
		writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]),
	});
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description, 4, undefined, 'owner-switch.wav').report,
		currentAuthority: authority(queuedDescription),
		revalidateAuthority: () => {
			finalAuthorityReads += 1;
			assert.equal(publicationFenceReached, true);
			throw new SoundscaperDeliveryContractError(
				'stale-project', 'The renderer owner switched its open project.',
			);
		},
	}), /owner switched/iu);
	assert.equal(finalAuthorityReads, 1);
	assert.equal(service.list().entries[0]?.state, 'stale');
	assert.equal(service.list().entries[0]?.lastFailureCode, 'stale-project');
	assert.deepEqual(await readdir(fixture.outputRoot), []);
	assert.deepEqual(await readdir(fixture.privateStagingRoot), []);
	await service.close();
});

interface FixtureStartOptions {
	readonly beforeFileFence?: (operation: string) => void;
	readonly readProjectIdentity?: () => Promise<ReturnType<typeof description>['projectIdentity']>;
}

async function createFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-adversarial-'));
	const outputRoot = join(root, 'outputs');
	const privateStagingRoot = join(root, 'private-staging');
	await mkdir(outputRoot);
	const filesystem = createSoundscaperDeliveryFilesystemFixture(privateStagingRoot);
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	return {
		outputRoot,
		privateStagingRoot,
		start: (options: FixtureStartOptions = {}) => SoundscaperDeliveryService.start({
			databasePath: join(root, 'delivery.sqlite'),
			filesystem,
			readProjectIdentity: options.readProjectIdentity ?? (async () => description().projectIdentity),
			...(options.beforeFileFence ? { beforeFileFence: options.beforeFileFence } : {}),
		}),
	};
}

function descriptionFor(destinationGrantId: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', sampleRate: 48_000 },
			exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
		}),
	});
}

function batchDescription(destinationGrantId: string, batchId: string, memberId: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Batch member', projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav' }, exportPlan: { format: 'wav', memberId },
			batch: { batchId, memberId, presetId: `preset-${memberId}`, target: { kind: 'project' }, mode: 'mix' },
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

function nested(depth: number): Readonly<Record<string, unknown>> {
	let value: Readonly<Record<string, unknown>> = Object.freeze({ end: true });
	for (let index = 0; index < depth; index += 1) value = Object.freeze({ child: value });
	return value;
}
