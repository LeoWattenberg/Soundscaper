/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { observeSoundscaperDeliveryRoot } from '../desktop/soundscaper-delivery-root.ts';
import { SoundscaperDeliveryService } from '../desktop/soundscaper-delivery-service.ts';
import { createSoundscaperDeliveryDescriptionV1 } from
	'../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from
	'../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { description } from './helpers/soundscaper-delivery-adapter-fixtures.ts';
import { createSoundscaperDeliveryFilesystemFixture } from
	'./helpers/soundscaper-delivery-filesystem-fixture.ts';

test('concurrent delivery claims cannot replace the first live claim', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-claim-race-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outputRoot = join(root, 'outputs');
	await mkdir(outputRoot);
	const bothRevalidating = deferred<void>();
	const releaseRevalidation = deferred<void>();
	let raceClaims = false;
	let revalidations = 0;
	const service = await SoundscaperDeliveryService.start({
		databasePath: join(root, 'delivery.sqlite'),
		filesystem: createSoundscaperDeliveryFilesystemFixture(join(root, 'private-staging')),
		readProjectIdentity: async (projectId: string) => projectId === 'album-project'
			? { projectId, projectRevision: 17, projectSha256: 'a'.repeat(64) }
			: null,
		observeRoot: async (path: unknown) => {
			if (raceClaims) {
				revalidations += 1;
				if (revalidations === 2) bothRevalidating.resolve();
				await releaseRevalidation.promise;
			}
			return observeSoundscaperDeliveryRoot(path);
		},
	});
	context.after(() => service.close());
	const grant = await service.authorizeRoot(outputRoot);
	const queued = deliveryDescription(grant.grantId);
	await service.enqueue(queued, null, admission(queued));
	await service.enqueue(queued, null, admission(queued));
	raceClaims = true;
	const claims = [service.claimNext(authority(queued)), service.claimNext(authority(queued))];
	await bothRevalidating.promise;
	releaseRevalidation.resolve();
	const settled = await Promise.all(claims);

	assert.equal(settled.filter((claim) => claim !== null).length, 1);
	assert.deepEqual(service.list().entries.map(({ attempt }) => attempt), [1, 0]);
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

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
