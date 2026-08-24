/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	consumeVideoProxyCandidateObservation,
	observeVideoProxyCandidate,
} from '../src/common/editor/video-proxy-candidate-observation.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { createFramescaperNativeProResProxyCandidateObserverV28 } from '../src/framescaper/editor-native-prores-proxy-candidate-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const ORIGINAL = new Uint8Array([8, 6, 7, 5]);
const PROXY = new Uint8Array([3, 0, 9]);
const JOB_ID = 'ab'.repeat(20);
const CLAIM_ID = 'bc'.repeat(20);

test('selected V28 proxy observer reaches queue V3 and consumes authenticated ProRes MOV pathlessly', async () => {
	const project = professionalProject();
	const events: string[] = [];
	let queueState: 'queued' | 'running' | 'completed' = 'queued';
	let admittedProjectRevision = -1;
	const bridge = {
		capabilities: async () => capabilities(),
		preferences: async () => ({ nativeMediaEnabled: true, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false }),
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: queueState === 'queued' && !events.includes('enqueue') ? [] : [queueProjection(queueState)],
			roots: [], watchRules: [],
		}),
		control: async () => queueProjection('cancelled'),
		reorder: async () => [], remove: async () => true,
		selectRoot: async () => {
			events.push('select-root');
			return { grantId: 'cd'.repeat(16), displayName: 'Proxy', revoked: false };
		},
		revalidateRoot: async () => true,
		enqueue: async (request: Readonly<Record<string, unknown>>) => {
			events.push('enqueue');
			assert.equal(request.taskKind, 'proxy-generation');
			assert.equal(request.planVersion, 14);
			assert.equal(request.derivedInputStageId, null);
			assert.match(String(request.relativeDestination), /^\.framescaper-native-proxies\/.+\.mov$/u);
			assert.deepEqual(request.inputFingerprints, [{
				sourceId: 'video-source', sha256: digest(ORIGINAL),
			}]);
			admittedProjectRevision = Number(request.projectRevision);
			queueState = 'running';
			return queueProjection('queued');
		},
		claimProxyOutput: async ({ jobId }: Readonly<{ jobId: string }>) => {
			assert.equal(jobId, JOB_ID);
			events.push('claim');
			return { claimId: CLAIM_ID, byteLength: PROXY.byteLength,
				sha256: digest(PROXY), mimeType: 'video/quicktime' as const };
		},
		readProxyOutput: async ({ offset, length }: Readonly<{ offset: number; length: number }>) => {
			events.push('read');
			return PROXY.slice(offset, offset + length);
		},
		releaseProxyOutput: async () => { events.push('release'); return true; },
	};
	const observer = createFramescaperNativeProResProxyCandidateObserverV28({
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		getProject: () => project,
		composition: {
			runtime: { probeVideoTiming: async () => ({
				nominalRate: { num: 24, den: 1 }, timescale: 24,
				presentationTicks: [0n, 1n, 2n], finalFrameDurationTicks: 1n,
			}) },
		},
		scope: { window: { framescaperDesktop: { v1: { nativeServices: bridge } } } },
		waitForPoll: async () => { queueState = 'completed'; },
	});
	assert.ok(observer);
	const original = new Blob([ORIGINAL], { type: 'video/mp4' });
	const observed = await observeVideoProxyCandidate(observer, {
		original,
		identity: {
			authority: 'owned', projectId: String(project.id), sourceId: 'video-source',
			storageKey: 'video-source', mimeType: original.type, byteLength: original.size,
			sha256: digest(ORIGINAL), generationToken: 'project-generation',
		},
		originalSourceId: 'video-source',
		assertCurrent: () => undefined,
	});
	const material = consumeVideoProxyCandidateObservation(observed);
	assert.equal(material.generatorId, 'framescaper-native-media-host');
	assert.equal(material.recipeId, 'framescaper-native-prores-proxy-mov-v1');
	assert.equal(material.mimeType, 'video/quicktime');
	assert.deepEqual(new Uint8Array(await material.candidate.arrayBuffer()), PROXY);
	assert.equal(admittedProjectRevision, project.revision);
	assert.deepEqual(events, ['select-root', 'enqueue', 'claim', 'read', 'release']);
});

function professionalProject() {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: digest(ORIGINAL), videoCodec: 'h264',
			characteristics: normalizeVideoSourceCharacteristicsV25({
				backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
				videoCodec: 'h264', hasAlpha: false, bitDepth: 10,
				pixelFormat: 'yuv420p10le', chromaFormat: '4:2:0',
			}) } : source
	));
	return createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, options);
}

function capabilities() {
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [{ domain: 'codec', id: 'encode-mov-prores-proxy',
			policyCleared: true, buildSupported: true, probeSucceeded: true,
			selfTestPassed: true, userEnabled: true }],
	});
}

function queueProjection(state: string) {
	return Object.freeze({
		jobId: JOB_ID, taskKind: 'proxy-generation' as const,
		projectId: 'framescaper-v20', relativeDestination: 'proxy.mov', state,
		position: 0, progress: state === 'completed' ? 1 : null,
		attempt: state === 'running' || state === 'completed' ? 1 : 0,
		lastFailureCode: null,
	});
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
