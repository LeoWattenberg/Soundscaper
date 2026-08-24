/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_PROXY_OUTPUT_MAXIMUM_OPEN_CLAIMS,
	FramescaperNativeProxyOutputBroker,
} from '../desktop/native-services-proxy-output-broker.ts';
import type { FramescaperNativeRootGrant } from '../desktop/native-services-root-repository.ts';
import { createNativeQueueRecordV3, type NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('completed native proxy output is reopened, authenticated, range-read, and owner-revoked pathlessly', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-proxy-output-'));
	try {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const relativeDestination = 'proxies/source.mov';
		await mkdir(join(directory, 'proxies'));
		await writeFile(join(directory, relativeDestination), bytes);
		const root = rootGrant(directory);
		const running = record(root, relativeDestination);
		let current: NativeQueueRecordV3 | null = running;
		const owner = {};
		const other = {};
		const broker = new FramescaperNativeProxyOutputBroker({
			queueRecord: () => current,
			rootGrant: () => root,
			mintClaimId: () => 'bc'.repeat(20),
		});
		broker.recordPublished(running, root, {
			planFingerprint: running.planFingerprint,
			byteLength: bytes.byteLength, sha256: digest(bytes),
		});
		await assert.rejects(broker.claim(owner, { jobId: running.jobId }), /completed/iu);
		current = { ...running, state: 'completed', progress: 1 };
		const claim = await broker.claim(owner, { jobId: running.jobId });
		assert.deepEqual(claim, { claimId: 'bc'.repeat(20), byteLength: bytes.byteLength,
			sha256: digest(bytes), mimeType: 'video/quicktime' });
		assert.deepEqual(await broker.read(owner, { claimId: claim.claimId, offset: 1, length: 3 }),
			new Uint8Array([2, 3, 4]));
		await assert.rejects(
			broker.read(other, { claimId: claim.claimId, offset: 0, length: 1 }), /not authorized/iu,
		);
		assert.equal(await broker.disposeOwner(owner), 1);
		assert.equal(await broker.release(owner, { claimId: claim.claimId }), false);
		assert.equal(await broker.dispose(), true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('proxy claims deduplicate an owner/job and reserve a bounded concurrent global capacity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-proxy-capacity-'));
	try {
		const bytes = new Uint8Array([6, 7, 8]);
		const relativeDestination = 'proxies/source.mov';
		await mkdir(join(directory, 'proxies'));
		await writeFile(join(directory, relativeDestination), bytes);
		const root = rootGrant(directory);
		const running = record(root, relativeDestination);
		const completed = { ...running, state: 'completed' as const, progress: 1 };
		let nextId = 1;
		const broker = new FramescaperNativeProxyOutputBroker({
			queueRecord: () => completed,
			rootGrant: () => root,
			mintClaimId: () => (nextId++).toString(16).padStart(40, '0'),
		});
		broker.recordPublished(running, root, {
			planFingerprint: running.planFingerprint,
			byteLength: bytes.byteLength,
			sha256: digest(bytes),
		});
		const firstOwner = {};
		const first = await broker.claim(firstOwner, { jobId: running.jobId });
		await assert.rejects(
			broker.claim(firstOwner, { jobId: running.jobId }),
			/already|duplicate|one.*claim/iu,
		);
		const owners = Array.from(
			{ length: FRAMESCAPER_NATIVE_PROXY_OUTPUT_MAXIMUM_OPEN_CLAIMS }, () => ({}),
		);
		const attempts = await Promise.allSettled(owners.map((owner) => (
			broker.claim(owner, { jobId: running.jobId })
		)));
		assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length,
			FRAMESCAPER_NATIVE_PROXY_OUTPUT_MAXIMUM_OPEN_CLAIMS - 1);
		assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
		assert.equal(await broker.disposeOwner(firstOwner), 1);
		const replacement = await broker.claim({}, { jobId: running.jobId });
		assert.equal(replacement.byteLength, bytes.byteLength);
		await broker.dispose();
		assert.equal(await broker.release(firstOwner, { claimId: first.claimId }), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function record(root: FramescaperNativeRootGrant, relativeDestination: string): NativeQueueRecordV3 {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectV28(profile, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const queued = createNativeQueueRecordV3({
		jobId: 'ab'.repeat(20), taskKind: 'proxy-generation', plan,
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: root.grantId, relativeDestination,
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: null },
		position: 0, createdAtMs: 1,
	});
	return { ...queued, state: 'running', attempt: 1 };
}

function rootGrant(rootPath: string): FramescaperNativeRootGrant {
	return Object.freeze({
		grantId: 'cd'.repeat(16), rootPath, volumeIdentity: 'volume', directoryIdentity: 'directory',
		authorizedAtMs: 1, revokedAtMs: null,
	});
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
