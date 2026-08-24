/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
} from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { FramescaperNativeMediaQueueDispatcherV3 } from '../desktop/native-media-queue-dispatcher-v3.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const GRANT_ID = 'f'.repeat(32);

test('a resume racing the aborted execution waits for it instead of colliding', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-pause', instanceId: 'instance-pause', processId: 9, nowMs: 0,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	roots.authorize({
		grantId: GRANT_ID, rootPath: '/private/export-root',
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a', authorizedAtMs: 0,
	}, lease, 0);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const record = createNativeQueueRecordV3({
		jobId: 'ab'.repeat(20), taskKind: 'encoded-export', plan,
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: GRANT_ID, relativeDestination: 'output.mov', reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 0,
			minimumFreeBytes: 0, hardwareBackend: null,
		}, position: 0, createdAtMs: 1,
	});
	queue.enqueue(record, lease, 1);
	let now = 1;
	let executions = 0;
	let started!: () => void;
	const executing = new Promise<void>((resolve) => { started = resolve; });
	const dispatcher = new FramescaperNativeMediaQueueDispatcherV3({
		queue, roots, lease: () => lease, now: () => ++now,
		available: () => true, nativeMediaEnabled: () => true,
		capacity: () => ({
			availableCpuCores: 4, availableProcessTreeRssBytes: 8 * 1_024 ** 3,
			availableScratchBytes: 64 * 1_024 ** 3, volumeFreeBytes: 128 * 1_024 ** 3,
			reservedFreeBytes: 0,
		}),
		prepare: async () => ({
			execute: ({ signal }) => {
				executions += 1;
				if (executions > 1) return Promise.resolve({});
				return new Promise((_resolve, reject) => {
					started();
					signal.addEventListener('abort', () => {
						// The old execution settles only after a delay, modelling a
						// helper still quiescing while the user already resumed.
						setTimeout(() => reject(new Error('aborted')), 25);
					}, { once: true });
				});
			},
			publish: async () => undefined,
			cleanup: async () => undefined,
		}),
		removeInactiveCarrier: async () => undefined,
	});
	const first = dispatcher.dispatch([record]);
	await executing;
	queue.control(record.jobId, { kind: 'pause' }, lease, ++now);
	await dispatcher.control(queue.read(record.jobId)!, 'pause');
	// The user resumes before the aborted execution has settled. The writer
	// -atomic claim must wait for the old execution rather than colliding with
	// it, which stranded same-pass admissions as durably running with no
	// executor and let the old settlement act on the freshly resumed row.
	queue.control(record.jobId, { kind: 'resume' }, lease, ++now);
	await dispatcher.control(queue.read(record.jobId)!, 'resume');
	await first.catch(() => undefined);
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(executions, 2, 'the resumed row must run again after the old execution settles');
	assert.equal(queue.read(record.jobId)?.state, 'completed');
	await dispatcher.dispose();
	database.close();
});
