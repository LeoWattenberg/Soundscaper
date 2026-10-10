/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import React, { act } from 'react';

import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
} from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import { framescaperNativeQueueProjection } from '../desktop/native-services-controller-contracts-v3.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import FramescaperNativeServicesDialog from '../src/common/editor/ui/dialogs/FramescaperNativeServicesDialog.tsx';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import {
	createFramescaperNativeServicesBridgeFixture,
	framescaperNativeRendererSnapshot,
	framescaperNativeServiceSnapshot,
} from './helpers/framescaper-native-services-surface-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const IDS = ['1a', '2b', '3c'].map((suffix) => suffix.repeat(20));

test('Background jobs moves queued jobs around each other after an ordinary cancellation', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'queue-reorder', instanceId: 'queue-reorder', processId: 1, nowMs: 0,
	});
	const grantId = 'f'.repeat(32);
	new FramescaperNativeRootRepository(database).authorize({
		grantId, rootPath: '/volumes/exports', volumeIdentity: 'volume-a',
		directoryIdentity: 'directory-a', authorizedAtMs: 0,
	}, lease, 0);
	const project = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const queue = new FramescaperNativeQueueRepository(database);
	for (const [position, jobId] of IDS.entries()) {
		queue.enqueue(createNativeQueueRecordV3({
			schemaFamily: 'framescaper', schemaVersion: 1, jobId, taskKind: 'encoded-export',
			plan, projectId: 'project-1', projectRevision: 1, inputFingerprints: [],
			rootGrantId: grantId, relativeDestination: `exports/job-${String(position + 1)}.mp4`,
			reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 4096,
				minimumFreeBytes: 0, hardwareBackend: null },
			position, createdAtMs: 0,
		}), lease, 1);
	}
	let nowMs = 2;
	const rows = () => queue.list().map(framescaperNativeQueueProjection);
	const services = () => ({ ...framescaperNativeServiceSnapshot(), queue: rows() });
	const fixture = createFramescaperNativeServicesBridgeFixture({
		snapshot: async () => services(),
		control: async ({ jobId, action }) => {
			assert.equal(action, 'cancel');
			return framescaperNativeQueueProjection(queue.control(jobId, { kind: 'cancel' }, lease, nowMs++).record);
		},
		reorder: async ({ jobId, index }) => queue.reorder(jobId, index, lease, nowMs++)
			.map(framescaperNativeQueueProjection),
	});
	const initial = framescaperNativeRendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const reactRoot = createRoot(dom.container as unknown as Element);
	const button = (jobId: string, label: string) => {
		const row = dom.one(`[data-native-queue-job="${jobId}"]`);
		const result = row.querySelectorAll('button').find((entry) => entry.textContent === label);
		assert.ok(result, `${label} for ${jobId}`);
		return result;
	};
	const click = async (jobId: string, label: string) => {
		assert.equal(button(jobId, label).hasAttribute('disabled'), false);
		await act(async () => {
			reactProps(button(jobId, label)).onClick?.();
			await Promise.resolve();
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		});
	};
	try {
		await act(async () => {
			reactRoot.render(<FramescaperNativeServicesDialog bridge={fixture.bridge}
				initialSurface="background-jobs" initialSnapshot={{ ...initial, services: services() }}
				onClose={() => undefined} />);
			await new Promise<void>((resolve) => { setImmediate(resolve); });
		});
		await click(IDS[1]!, 'Move earlier');
		assert.deepEqual(rows().map(({ jobId }) => jobId), [IDS[1], IDS[0], IDS[2]]);
		await click(IDS[1]!, 'Move later');
		assert.deepEqual(rows().map(({ jobId }) => jobId), IDS);
		await click(IDS[0]!, 'Cancel');
		assert.equal(queue.read(IDS[0]!)?.state, 'cancelled');
		await click(IDS[2]!, 'Move earlier');
		assert.deepEqual(rows().map(({ jobId }) => jobId), [IDS[0], IDS[2], IDS[1]]);
		assert.equal(button(IDS[2]!, 'Move earlier').hasAttribute('disabled'), true);
		assert.equal(button(IDS[1]!, 'Move later').hasAttribute('disabled'), true);
		await click(IDS[2]!, 'Move later');
		assert.deepEqual(rows().map(({ jobId }) => jobId), IDS);
		assert.equal(button(IDS[0]!, 'Move earlier').hasAttribute('disabled'), true);
		assert.equal(button(IDS[0]!, 'Move later').hasAttribute('disabled'), true);
	} finally {
		await act(async () => reactRoot.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
		database.close();
	}
});
