/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	SoundscaperDeliveryFilesystemUnavailableError,
	createUnavailableSoundscaperDeliveryFilesystemAuthority,
} from '../desktop/soundscaper-delivery-filesystem-authority.ts';
import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import {
	createSoundscaperDeliveryFilesystemFixture,
} from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('preview fallback implements every filesystem operation as one typed unavailability', async () => {
	const detail = 'Authenticated professional payload is pending.';
	const filesystem = createUnavailableSoundscaperDeliveryFilesystemAuthority(detail);
	for (const operation of [
		() => filesystem.open({} as never),
		() => filesystem.removeRecovered({} as never, 'recovery-token', {} as never, () => undefined),
		() => filesystem.inspectFinal({} as never, 'master.wav', () => undefined),
	]) {
		await assert.rejects(operation, (error: unknown) => {
			assert.ok(error instanceof SoundscaperDeliveryFilesystemUnavailableError);
			assert.equal(error.code, 'delivery-filesystem-unavailable');
			assert.match(error.message, /professional payload is pending/iu);
			return true;
		});
	}
});

test('preview fallback permits fresh startup and contains interrupted journal recovery', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-unavailable-'));
	const outputRoot = join(root, 'output');
	const databasePath = join(root, 'delivery.sqlite');
	await mkdir(outputRoot);
	context.after(() => rm(root, { recursive: true, force: true }));
	const unavailable = createUnavailableSoundscaperDeliveryFilesystemAuthority('payload absent');
	const startUnavailable = (path = databasePath) => SoundscaperDeliveryService.start({
		databasePath: path, filesystem: unavailable,
		readProjectIdentity: async () => description().projectIdentity,
	});
	const fresh = await startUnavailable(join(root, 'fresh.sqlite'));
	await fresh.close();

	const service = await SoundscaperDeliveryService.start({
		databasePath,
		filesystem: createSoundscaperDeliveryFilesystemFixture(join(root, 'private')),
		readProjectIdentity: async () => description().projectIdentity,
	});
	const grant = await service.authorizeRoot(outputRoot);
	const queuedDescription = createSoundscaperDeliveryDescriptionV1({
		label: 'Interrupted master', projectIdentity: description().projectIdentity,
		destinationGrantId: grant.grantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 }, batch: null,
		}),
	});
	const queued = await service.enqueue(queuedDescription, null, admission(queuedDescription));
	const claim = await service.claimNext(authority(queuedDescription));
	const write = await service.beginWrite({ claimId: claim!.claimId, fileName: 'interrupted.wav', size: 4 });
	await service.writeChunk({
		writeId: write.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]),
	});
	await service.finishWrite(write.writeId);
	const database = new DatabaseSync(databasePath);
	const row = database.prepare('SELECT * FROM delivery_queue WHERE job_id = ?')
		.get(queued.jobId) as Record<string, unknown>;
	const report = result(queuedDescription, 4, String(row.staged_sha256), 'interrupted.wav').report;
	database.prepare(`
		INSERT INTO delivery_publication_journal (
			job_id, staging_name, final_name, byte_length, sha256, result_json, phase, created_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)
	`).run(
		queued.jobId, String(row.staging_name), 'interrupted.wav', Number(row.staged_byte_length),
		String(row.staged_sha256),
		JSON.stringify(result(queuedDescription, 4, String(row.staged_sha256), 'interrupted.wav')), 1,
	);
	database.exec(`
		UPDATE delivery_writer_lease SET lease_id = 'crash-takeover',
			fencing_token = fencing_token + 1, owner_process_id = 999,
			owner_instance_id = 'crash-takeover', expires_at_ms = 9999999999999
		WHERE singleton = 1
	`);
	await service.close();
	database.exec('UPDATE delivery_writer_lease SET active = 0, expires_at_ms = 0 WHERE singleton = 1');
	database.close();

	const recovered = await startUnavailable();
	const entry = recovered.list().entries.find(({ jobId }) => jobId === queued.jobId);
	assert.equal(entry?.state, 'failed');
	assert.equal(entry?.lastFailureCode, 'staging-ownership-lost');
	assert.deepEqual(entry?.report, report);
	assert.deepEqual(entry?.reportHistory, [{
		attempt: 1, outcome: 'failed', failureCode: 'staging-ownership-lost', report,
	}]);
	await recovered.close();
});

function authority(value: ReturnType<typeof createSoundscaperDeliveryDescriptionV1>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity, planFingerprint: value.planFingerprint,
	});
}

function admission(value: ReturnType<typeof createSoundscaperDeliveryDescriptionV1>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity, planFingerprints: Object.freeze([value.planFingerprint]),
		saved: true as const, clean: true as const, named: true as const,
	});
}
