/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description, result } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import { createSoundscaperDeliveryFilesystemFixture } from './helpers/soundscaper-delivery-filesystem-fixture.ts';

test('validated success and failure reports survive service restart independently of results', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-reports-'));
	const outputRoot = join(root, 'output');
	const privateRoot = join(root, 'private');
	const databasePath = join(root, 'delivery.sqlite');
	await mkdir(outputRoot);
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const filesystem = createSoundscaperDeliveryFilesystemFixture(privateRoot);
	const start = () => SoundscaperDeliveryService.start({
		databasePath, filesystem,
		readProjectIdentity: async () => description().projectIdentity,
	});

	let service = await start();
	const grant = await service.authorizeRoot(outputRoot);
	const failedDescription = queuedDescription(grant.grantId, 'Failed master');
	const completedDescription = queuedDescription(grant.grantId, 'Completed master');
	const failed = await service.enqueue(failedDescription, null, admission(failedDescription));
	const completed = await service.enqueue(completedDescription, null, admission(completedDescription));
	const failedClaim = await service.claimNext(authority(failedDescription));
	const failedReport = result(failedDescription).report;
	await service.fail(failedClaim!.claimId, 'encode-failed', failedReport);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.report, failedReport);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.reportHistory, [{
		attempt: 1, outcome: 'failed', failureCode: 'encode-failed', report: failedReport,
	}]);
	assert.equal(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.result, null);
	service.retry(failed.jobId);
	const retriedClaim = await service.claimNext(authority(failedDescription), failed.jobId);
	assert.ok(retriedClaim);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.report, failedReport,
		'claiming a retry must not erase the preceding attempt report');
	const secondFailedReport = {
		...failedReport,
		items: [{ code: 'retry-failed', severity: 'error', disposition: 'missing', scope: {}, data: {} }],
		counts: { preserved: 0, converted: 0, missing: 1, omitted: 0 },
	};
	await service.fail(retriedClaim.claimId, 'retry-encode-failed', secondFailedReport);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.reportHistory, [
		{ attempt: 1, outcome: 'failed', failureCode: 'encode-failed', report: failedReport },
		{ attempt: 2, outcome: 'failed', failureCode: 'retry-encode-failed', report: secondFailedReport },
	]);
	await service.close();

	service = await start();
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.report, secondFailedReport);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === failed.jobId)?.reportHistory, [
		{ attempt: 1, outcome: 'failed', failureCode: 'encode-failed', report: failedReport },
		{ attempt: 2, outcome: 'failed', failureCode: 'retry-encode-failed', report: secondFailedReport },
	]);
	const completedClaim = await service.claimNext(authority(completedDescription), completed.jobId);
	const write = await service.beginWrite({
		claimId: completedClaim!.claimId, fileName: 'completed.wav', size: 4,
	});
	await service.writeChunk({ writeId: write.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]) });
	await service.finishWrite(write.writeId);
	const completedReport = result(completedDescription, 4, undefined, 'completed.wav').report;
	await service.complete({
		claimId: completedClaim!.claimId,
		report: completedReport,
		currentAuthority: authority(completedDescription),
		revalidateAuthority: () => authority(completedDescription),
	});
	await service.close();

	service = await start();
	const rows = new Map(service.list().entries.map((entry) => [entry.jobId, entry]));
	assert.deepEqual(rows.get(failed.jobId)?.report, secondFailedReport);
	assert.deepEqual(rows.get(failed.jobId)?.reportHistory.map(({ attempt, failureCode }) => ({ attempt, failureCode })), [
		{ attempt: 1, failureCode: 'encode-failed' },
		{ attempt: 2, failureCode: 'retry-encode-failed' },
	]);
	assert.deepEqual(rows.get(completed.jobId)?.report, completedReport);
	assert.deepEqual(rows.get(completed.jobId)?.reportHistory, [{
		attempt: 1, outcome: 'completed', failureCode: null, report: completedReport,
	}]);
	assert.deepEqual(rows.get(completed.jobId)?.result?.report, completedReport);
	const conflictDescription = queuedDescription(grant.grantId, 'Conflicted master');
	const conflict = await service.enqueue(conflictDescription, null, admission(conflictDescription));
	const conflictClaim = await service.claimNext(authority(conflictDescription), conflict.jobId);
	const conflictWrite = await service.beginWrite({
		claimId: conflictClaim!.claimId, fileName: 'conflict.wav', size: 4,
	});
	await service.writeChunk({
		writeId: conflictWrite.writeId, offset: 0, bytes: new Uint8Array([1, 2, 3, 4]),
	});
	await service.finishWrite(conflictWrite.writeId);
	await writeFile(join(outputRoot, 'conflict.wav'), new Uint8Array([9, 9, 9, 9]));
	const conflictReport = result(conflictDescription, 4, undefined, 'conflict.wav').report;
	await assert.rejects(service.complete({
		claimId: conflictClaim!.claimId, report: conflictReport,
		currentAuthority: authority(conflictDescription),
		revalidateAuthority: () => authority(conflictDescription),
	}), /exists|replace|conflict/iu);
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === conflict.jobId)?.report, conflictReport);
	await service.close();
	service = await start();
	assert.deepEqual(service.list().entries.find(({ jobId }) => jobId === conflict.jobId)?.report, conflictReport);
	await service.close();
	const evidence = new DatabaseSync(databasePath);
	assert.throws(() => evidence.prepare(`
		UPDATE delivery_attempt_reports SET failure_code = 'rewritten' WHERE job_id = ?
	`).run(failed.jobId), /append-only/iu);
	assert.throws(() => evidence.prepare(
		'DELETE FROM delivery_attempt_reports WHERE job_id = ?',
	).run(failed.jobId), /append-only/iu);
	assert.equal(Number((evidence.prepare(
		'SELECT COUNT(*) AS count FROM delivery_attempt_reports WHERE job_id = ?',
	).get(failed.jobId) as Record<string, unknown>).count), 2);
	evidence.close();
});

function queuedDescription(destinationGrantId: string, label: string) {
	return createSoundscaperDeliveryDescriptionV1({
		label, projectIdentity: description().projectIdentity, destinationGrantId,
		plan: createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', sampleRate: 48_000 },
			exportPlan: { format: 'wav', sampleRate: 48_000, range: 'project' },
		}),
	});
}

function authority(value: ReturnType<typeof queuedDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity,
		planFingerprint: value.planFingerprint,
	});
}

function admission(value: ReturnType<typeof queuedDescription>) {
	return Object.freeze({
		projectIdentity: value.projectIdentity,
		planFingerprints: Object.freeze([value.planFingerprint]),
		saved: true as const, clean: true as const, named: true as const,
	});
}
