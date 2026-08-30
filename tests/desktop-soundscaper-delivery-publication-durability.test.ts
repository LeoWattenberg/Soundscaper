/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createSoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import {
	createSoundscaperDeliveryFilesystemFixture,
} from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('publication durably syncs the destination directory before advancing its journal', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-durability-'));
	const outputRoot = join(root, 'outputs');
	await mkdir(outputRoot);
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	let permitDurability = false;
	let durabilityAttempts = 0;
	const databasePath = join(root, 'delivery.sqlite');
	const filesystem = createSoundscaperDeliveryFilesystemFixture(join(root, 'private-staging'));
	const start = (beforeFileFence?: (operation: string) => void) => SoundscaperDeliveryService.start({
		databasePath, filesystem,
		readProjectIdentity: async () => description().projectIdentity,
		...(beforeFileFence ? { beforeFileFence } : {}),
	});
	const service = await start((operation) => {
		if (operation !== 'directory-sync') return;
		durabilityAttempts += 1;
		if (!permitDurability) throw new Error('injected directory durability refusal');
	});
	const grant = await service.authorizeRoot(outputRoot);
	const queuedDescription = deliveryDescription(grant.grantId);
	await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: 'durable.wav', size: 4 });
	await service.writeChunk({ writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(writer.writeId);
	await assert.rejects(service.complete({
		claimId: claim!.claimId,
		report: result(claim!.description, 4, undefined, 'durable.wav').report,
		currentAuthority: authority(queuedDescription),
		revalidateAuthority: () => authority(queuedDescription),
	}), /directory durability refusal/u);
	assert.ok(durabilityAttempts >= 2, 'publication and prepared settlement both require the barrier');
	assert.equal(service.list().entries[0]?.state, 'running');
	permitDurability = true;
	await service.close();
	const recovered = await start();
	assert.equal(recovered.list().entries[0]?.state, 'completed');
	assert.deepEqual([...await readFile(join(outputRoot, 'durable.wav'))], [1, 2, 3, 4]);
	await recovered.close();
});

function deliveryDescription(destinationGrantId: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', sampleRate: 48_000 },
			exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
		}),
	});
}

function authority(value: ReturnType<typeof deliveryDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity,
		planFingerprint: value.planFingerprint,
	});
}

function admission(value: ReturnType<typeof deliveryDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity,
		planFingerprints: Object.freeze([value.planFingerprint]),
		saved: true as const, clean: true as const, named: true as const,
	});
}
