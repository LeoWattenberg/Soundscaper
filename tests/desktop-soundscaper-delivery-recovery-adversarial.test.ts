/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createSoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import {
	createSoundscaperDeliveryFilesystemFixture,
} from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('startup blocks ambiguous finals and foreign recovery stages without stopping other jobs', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-recovery-adversarial-'));
	const outputRoot = join(root, 'outputs');
	const privateRoot = join(root, 'private-staging');
	const databasePath = join(root, 'delivery.sqlite');
	await mkdir(outputRoot);
	context.after(() => rm(root, { recursive: true, force: true }));
	let finalInspections = 0;
	const baseFilesystem = createSoundscaperDeliveryFilesystemFixture(privateRoot);
	const filesystem = Object.freeze({
		...baseFilesystem,
		inspectFinal: (...args: Parameters<typeof baseFilesystem.inspectFinal>) => {
			finalInspections += 1;
			return baseFilesystem.inspectFinal(...args);
		},
	});
	const start = () => SoundscaperDeliveryService.start({
		databasePath, filesystem,
		readProjectIdentity: async () => description().projectIdentity,
	});
	const service = await start();
	const grant = await service.authorizeRoot(outputRoot);
	const database = new DatabaseSync(databasePath);
	const prepared = [] as Array<Readonly<{ jobId: string; finalName: string; recoveryToken: string }>>;
	for (const finalName of ['symlink.wav', 'directory.wav', 'foreign-stage.wav', 'continues.wav']) {
		const queuedDescription = deliveryDescription(grant.grantId, finalName);
		const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
		const claim = await service.claimNext(authority(queuedDescription));
		const writer = await service.beginWrite({ claimId: claim!.claimId, fileName: finalName, size: 4 });
		await service.writeChunk({
			writeId: writer.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]),
		});
		await service.finishWrite(writer.writeId);
		const row = database.prepare('SELECT * FROM delivery_queue WHERE job_id = ?')
			.get(queued.jobId) as Record<string, unknown>;
		database.prepare(`
			INSERT INTO delivery_publication_journal (
				job_id, staging_name, final_name, byte_length, sha256, result_json, phase, created_at_ms
			) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)
		`).run(
			queued.jobId, String(row.staging_name), finalName,
			Number(row.staged_byte_length), String(row.staged_sha256),
			JSON.stringify(result(queuedDescription, 4, String(row.staged_sha256), finalName)),
			prepared.length + 1,
		);
		// Let this single-writer fixture prepare the next row; all journal rows are
		// restored to their interrupted running state before the owner closes.
		database.prepare("UPDATE delivery_queue SET state = 'failed', last_failure_code = 'fixture-hold' WHERE job_id = ?")
			.run(queued.jobId);
		prepared.push(Object.freeze({
			jobId: queued.jobId, finalName, recoveryToken: String(row.staging_recovery_token),
		}));
	}
	database.exec("UPDATE delivery_queue SET state = 'running', last_failure_code = NULL WHERE job_id IN (SELECT job_id FROM delivery_publication_journal)");
	database.exec(`
		UPDATE delivery_writer_lease SET lease_id = 'crash-takeover',
			fencing_token = fencing_token + 1, owner_process_id = 999,
			owner_instance_id = 'crash-takeover', expires_at_ms = 9999999999999
		WHERE singleton = 1
	`);
	await service.close();
	database.exec('UPDATE delivery_writer_lease SET active = 0, expires_at_ms = 0 WHERE singleton = 1');
	database.close();
	await writeFile(join(root, 'foreign-target.wav'), new Uint8Array([8, 8, 8, 8]));
	await symlink(join(root, 'foreign-target.wav'), join(outputRoot, prepared[0]!.finalName));
	await mkdir(join(outputRoot, prepared[1]!.finalName));
	const foreignStagePath = join(privateRoot, `${prepared[2]!.recoveryToken}.stage`);
	const identityBeforeTamper = await stat(foreignStagePath, { bigint: true });
	await writeFile(foreignStagePath, new Uint8Array([9, 9, 9, 9]));
	const identityAfterTamper = await stat(foreignStagePath, { bigint: true });
	assert.equal(identityAfterTamper.ino, identityBeforeTamper.ino,
		'the adversary changes sealed bytes in place without changing inode identity');

	const recovered = await start();
	assert.ok(finalInspections >= prepared.length,
		'crash recovery inspects every final through the authenticated filesystem authority');
	const entries = new Map(recovered.list().entries.map((entry) => [entry.jobId, entry]));
	assert.equal(entries.get(prepared[0]!.jobId)?.lastFailureCode, 'publication-conflict');
	assert.equal(entries.get(prepared[1]!.jobId)?.lastFailureCode, 'publication-conflict');
	assert.equal(entries.get(prepared[2]!.jobId)?.lastFailureCode, 'staging-ownership-lost');
	assert.equal(entries.get(prepared[3]!.jobId)?.state, 'waiting-for-project');
	assert.equal(entries.get(prepared[3]!.jobId)?.lastFailureCode, null);
	assert.equal((await lstat(join(outputRoot, prepared[0]!.finalName))).isSymbolicLink(), true);
	assert.equal((await lstat(join(outputRoot, prepared[1]!.finalName))).isDirectory(), true);
	assert.deepEqual([...await readFile(foreignStagePath)], [9, 9, 9, 9]);
	await recovered.close();
});

function deliveryDescription(destinationGrantId: string, label: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label, projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', sampleRate: 48_000 },
			exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
		}),
	});
}

function authority(value: ReturnType<typeof deliveryDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity, planFingerprint: value.planFingerprint,
	});
}

function admission(value: ReturnType<typeof deliveryDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity, planFingerprints: Object.freeze([value.planFingerprint]),
		saved: true as const, clean: true as const, named: true as const,
	});
}
