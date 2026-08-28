/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { FramescaperNativeProjectAuthority } from '../desktop/native-services-project-authority.ts';
import {
	assertNativeQueueRecordV2,
	createNativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const PROJECT_IDENTITY = Object.freeze({
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
});

test('the main-private authority revalidates machine facts without consulting milestone-9 review', async () => {
	const plan = nativeQueueKeyedPlanV7();
	const inputs = Object.freeze([
		Object.freeze({ sourceId: 'source-a', sha256: '12'.repeat(32) }),
		Object.freeze({ sourceId: 'source-b', sha256: '34'.repeat(32) }),
	]);
	const record = createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: '01'.repeat(20), taskKind: 'encoded-export', plan,
		projectId: 'project-1', projectRevision: 7, inputFingerprints: inputs,
		rootGrantId: 'ab'.repeat(16), relativeDestination: 'export.mov',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 64 * 1_024 * 1_024,
			scratchBytes: 1_024, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
	let revision = 7;
	const root = Object.freeze({
		grantId: record.rootGrantId, rootPath: '/private/exports',
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
		authorizedAtMs: 1, revokedAtMs: null,
	});
	const authority = new FramescaperNativeProjectAuthority({
		project: {
			...PROJECT_IDENTITY,
			projectState: () => Object.freeze({ ...PROJECT_IDENTITY, open: true, writable: true }),
			projectRecord: () => Object.freeze({
				...PROJECT_IDENTITY,
				projectId: 'project-1', projectRevision: revision,
				projectSha256: '56'.repeat(32),
				bodies: Object.freeze(inputs.map((input) => Object.freeze({
					kind: 'video-original' as const, sourceId: input.sourceId,
					encoding: 'framescaper-video-original-v1', storageKey: input.sourceId,
					mimeType: 'video/mp4',
					byteLength: 1, sha256: input.sha256,
				}))),
			}),
			readProjectBundle: async () => null,
			readBody: async () => new Uint8Array(),
		},
		scratchRoot: '/private/scratch',
		executable: () => Object.freeze({
			path: '/private/media-host', byteLength: 1, sha256: '78'.repeat(32),
			identity: Object.freeze({ dev: 1, ino: 2 }),
		}),
		createMessageChannel: () => { throw new Error('must not stage during revalidation'); },
		probeRoot: async () => Object.freeze({
			exists: true, directory: true, symbolicLink: false,
			canonicalPath: root.rootPath, volumeIdentity: root.volumeIdentity,
			directoryIdentity: root.directoryIdentity,
		}),
		publicationPortFor: () => { throw new Error('must not publish during revalidation'); },
		publicationFenceFor: () => { throw new Error('must not fence during revalidation'); },
		reserveScratch: () => undefined,
		settleScratch: async () => undefined,
		scratchMatches: () => true,
	});

	assert.deepEqual(await authority.revalidate(record, root, true), {
		projectRevisionMatches: true, planFingerprintMatches: true,
		inputFingerprintsMatch: true, rootGrantAuthorized: true, rootGrantValid: true,
		helperBuildMatches: true, scratchIdentityMatches: true,
	});
	await assert.rejects(
		() => authority.prepare(record, root),
		/V12 native project bundle is unavailable/iu,
		'prepare must reach machine project admission without a human-review dependency',
	);
	revision = 8;
	assert.equal((await authority.revalidate(record, root, true)).projectRevisionMatches, false);
});

test('project revalidation derives verified image-sequence recovery progress from main-owned evidence', async () => {
	const plan = nativeQueueKeyedPlanV7();
	const inputs = Object.freeze([
		Object.freeze({ sourceId: 'source-a', sha256: '12'.repeat(32) }),
		Object.freeze({ sourceId: 'source-b', sha256: '34'.repeat(32) }),
	]);
	const queued = createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: '02'.repeat(20), taskKind: 'image-sequence-export', plan,
		projectId: 'project-1', projectRevision: 7, inputFingerprints: inputs,
		rootGrantId: 'ab'.repeat(16), relativeDestination: 'frames/frame.png',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 64 * 1_024 * 1_024,
			scratchBytes: 1_024, minimumFreeBytes: 0, hardwareBackend: null,
		},
		recoveryClass: 'verified-frame-checkpoint', position: 0, createdAtMs: 1,
	});
	const running = Object.freeze({
		...queued, state: 'running' as const, progress: 0, attempt: 1, updatedAtMs: 2,
	});
	assertNativeQueueRecordV2(running);
	const sourceInventoryDigest = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
	const frames = [0, 1].map((frameIndex) => Object.freeze({
		frameIndex,
		relativePath: `frames/frame-${String(frameIndex).padStart(6, '0')}.png`,
		byteLength: frameIndex + 10,
		sha256: String(frameIndex + 1).repeat(64),
		planFingerprint: running.planFingerprint,
		sourceInventoryDigest,
	}));
	const root = Object.freeze({
		grantId: running.rootGrantId, rootPath: '/private/exports',
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
		authorizedAtMs: 1, revokedAtMs: null,
	});
	const reported: unknown[] = [];
	let storedCheckpoint = Object.freeze({
		version: 1 as const, jobId: running.jobId,
		planFingerprint: running.planFingerprint, sourceInventoryDigest,
		plannedFrameCount: 30, manifest: Object.freeze(frames),
	});
	const authority = new FramescaperNativeProjectAuthority({
		project: {
			...PROJECT_IDENTITY,
			projectState: () => Object.freeze({ ...PROJECT_IDENTITY, open: true, writable: true }),
			projectRecord: () => Object.freeze({
				...PROJECT_IDENTITY,
				projectId: 'project-1', projectRevision: 7, projectSha256: '56'.repeat(32),
				bodies: Object.freeze(inputs.map((input) => Object.freeze({
					kind: 'video-original' as const, sourceId: input.sourceId,
					encoding: 'framescaper-video-original-v1', storageKey: input.sourceId,
					mimeType: 'video/mp4', byteLength: 1, sha256: input.sha256,
				}))),
			}),
			readProjectBundle: async () => null,
			readBody: async () => new Uint8Array(),
		},
		scratchRoot: '/private/scratch',
		executable: () => Object.freeze({
			path: '/private/media-host', byteLength: 1, sha256: '78'.repeat(32),
			identity: Object.freeze({ dev: 1, ino: 2 }),
		}),
		createMessageChannel: () => { throw new Error('must not stage during revalidation'); },
		probeRoot: async () => Object.freeze({
			exists: true, directory: true, symbolicLink: false,
			canonicalPath: root.rootPath, volumeIdentity: root.volumeIdentity,
			directoryIdentity: root.directoryIdentity,
		}),
		publicationPortFor: () => { throw new Error('must not publish during revalidation'); },
		publicationFenceFor: () => { throw new Error('must not fence during revalidation'); },
		reserveScratch: () => undefined, settleScratch: async () => undefined,
		scratchMatches: () => true,
		checkpointStore: {
			read: async () => storedCheckpoint,
			write: async () => undefined,
		},
		checkpointInspectFor: () => async (frame) => Object.freeze({
			byteLength: frame.byteLength, sha256: frame.sha256, symbolicLink: false,
		}),
		onCheckpointError: (error) => reported.push(error),
	});

	const revalidation = await authority.revalidate(running, root, true);
	assert.equal(revalidation.verifiedFrameCount, 2);
	assert.equal(revalidation.plannedFrameCount, 30);
	assert.deepEqual(reported, []);
	storedCheckpoint = Object.freeze({ ...storedCheckpoint, sourceInventoryDigest: 'f'.repeat(64) });
	const stale = await authority.revalidate(running, root, true);
	assert.equal(stale.verifiedFrameCount, 0);
	assert.equal(stale.plannedFrameCount, 30);
	assert.equal(reported.length, 1);
});
