/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createNativeMediaOutputTreeIdentity,
	type NativeMediaAuthenticatedOutputTree,
	type NativeMediaOutputTreeSummaryV1,
} from '../desktop/native-media-output-tree.ts';
import type { FramescaperNativeMediaV14RuntimeRequest } from '../desktop/native-media-v14-runtime-contract.ts';
import { FramescaperNativeProjectMediaAuthority } from '../desktop/native-services-project-media-authority.ts';
import type { FramescaperNativeRootGrant } from '../desktop/native-services-root-repository.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const JOB_ID = 'ab'.repeat(20);
const ROOT: FramescaperNativeRootGrant = Object.freeze({
	grantId: 'cd'.repeat(16), rootPath: '/private/v28-sequence-exports',
	volumeIdentity: 'volume-v28', directoryIdentity: 'directory-v28',
	authorizedAtMs: 1, revokedAtMs: null,
});
const PROJECT_IDENTITY = Object.freeze({ schemaFamily: 'framescaper' as const, schemaVersion: 1 as const });

test('baseline image-sequence jobs publish their authenticated tree through the directory broker', async () => {
	const sourceBytes = new Uint8Array([1, 2, 3, 4]);
	const sourceSha256 = digest(sourceBytes);
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: sourceSha256 } : source
	));
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const basePlan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const plan = {
		...basePlan,
		format: { container: 'image2', extension: 'png', mimeType: 'image/png' },
		deliveryProfile: 'encode-png-sequence',
		codecs: { video: 'png', videoEncoder: 'png', audio: null,
			audioEncoder: null, pixelFormat: 'rgba64be' },
		output: { ...basePlan.output,
			canvas: { ...basePlan.output.canvas, pixelFormat: 'rgba64be' },
			includeAudio: false, audioLayout: null },
	};
	const record = createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: JOB_ID, taskKind: 'image-sequence-export', plan,
		projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: sourceSha256 }],
		rootGrantId: ROOT.grantId, relativeDestination: 'sequences/final-png',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 4 * 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: null },
		recoveryClass: 'verified-frame-checkpoint', position: 0, createdAtMs: 1,
	});
	const projectSha256 = 'ef'.repeat(32);
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'blob-v1', sourceId: 'video-source',
		storageKey: 'video-source', mimeType: 'video/mp4', byteLength: sourceBytes.byteLength,
		sha256: sourceSha256,
	});
	const events: string[] = [];
	let published = false;
	let observation: NativeMediaAuthenticatedOutputTree | null = null;
	const requests: FramescaperNativeMediaV14RuntimeRequest[] = [];
	const authority = new FramescaperNativeProjectMediaAuthority({
		project: {
			...PROJECT_IDENTITY,
			projectState: () => ({ ...PROJECT_IDENTITY, open: true, writable: true }),
			projectRecord: () => ({ projectId: String(project.id), projectRevision: Number(project.revision),
				...PROJECT_IDENTITY, projectSha256, bodies: [body] }),
			readProjectBundle: async () => ({
				project: { ...PROJECT_IDENTITY, projectRevision: Number(project.revision), sha256: projectSha256 }, bodies: [body],
			}),
			readBody: async () => sourceBytes.slice(),
			materializeBody: async () => ({ byteLength: sourceBytes.byteLength, sha256: sourceSha256 }),
		},
		watch: { projectState: () => ({ ...PROJECT_IDENTITY, open: true, writable: true,
			binId: 'project-bin' as const }) },
		runtime: {
			available: () => true,
			executeProxyV14: async () => { throw new Error('proxy route must not run'); },
			executeV14: async (request) => {
				requests.push(request);
				const identity = createNativeMediaOutputTreeIdentity({
					jobId: request.attempt.jobId, planFingerprint: request.attempt.envelope.fingerprint,
					rootGrantId: request.attempt.rootGrantId,
					relativeDestination: request.attempt.relativeDestination,
					sources: request.attempt.sources,
					profileId: 'encode-png-sequence',
					frameCount: request.attempt.envelope.summary.outputFrameCount,
				});
				const tree = Object.freeze({ identity,
					fileCount: identity.frameCount + 1, manifestByteLength: 512,
					manifestSha256: '56'.repeat(32) });
				observation = treeObservation(tree);
				return Object.freeze({
					planFingerprint: request.attempt.envelope.fingerprint,
					byteLength: observation.byteLength, sha256: observation.sha256,
					publication: 'verified-temporary' as const, tree,
				});
			},
		},
		renderInputs: {
			revalidate: async () => true,
			inspect: async () => ({ byteLength: 16, materialize: async () => Object.freeze([]) }),
			settle: async () => undefined,
		},
		platform: 'linux',
		probeRoot: async () => ({ exists: true, directory: true, symbolicLink: false,
			canonicalPath: ROOT.rootPath, volumeIdentity: ROOT.volumeIdentity,
			directoryIdentity: ROOT.directoryIdentity }),
		publicationPortFor: () => ({
			inspect: async () => { throw new Error('sequence publication must not use the file broker'); },
			renameTemporarySibling: async () => { throw new Error('file rename must not run'); },
			removePublishedOutput: async () => { throw new Error('file cleanup must not run'); },
			inspectOutputTree: async (relativePath) => {
				events.push(relativePath === record.relativeDestination ? 'inspect-final' : 'inspect-temporary');
				return relativePath === record.relativeDestination ? (published ? observation : null) : observation;
			},
			renameTemporaryOutputTree: async () => { events.push('rename-tree'); published = true; },
			removePublishedOutputTree: async () => { events.push('remove-tree'); published = false; },
		}),
		publicationFenceFor: () => ({
			...PROJECT_IDENTITY, projectId: record.projectId, projectRevision: record.projectRevision,
			beforePublication: async () => { events.push('fence-before'); },
			afterPublication: async () => { events.push('fence-after'); },
		}),
	});

	const prepared = await authority.prepare(record, ROOT);
	const result = await prepared.execute!({ signal: new AbortController().signal, onProgress: () => undefined });
	await prepared.publish!(result);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.attempt.jobId, JOB_ID);
	assert.equal(requests[0]?.attempt.envelope.plan.deliveryProfile, 'encode-png-sequence');
	assert.deepEqual(events, [
		'inspect-final', 'inspect-temporary', 'fence-before',
		'rename-tree', 'inspect-final', 'fence-after',
	]);
	assert.equal(published, true);
	await prepared.cleanup?.('succeeded');
});

function treeObservation(tree: NativeMediaOutputTreeSummaryV1): NativeMediaAuthenticatedOutputTree {
	return Object.freeze({
		kind: 'directory' as const, byteLength: 4096, sha256: '56'.repeat(32),
		identity: Object.freeze({ dev: 7, ino: 11 }), tree,
	});
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
