/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	type VideoProxyClaimRecord,
	videoProxyClaimKey,
} from '../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	collectFramescaperProjectStorageRootsV18,
} from '../src/framescaper/editor-project-v18-retention.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const NOW = '2026-08-13T10:00:00.000Z';
const ORIGINAL_SHA = '12'.repeat(32);
const CANONICAL_TIMING_SHA = '23'.repeat(32);
const CANONICAL_SOURCE_KEY = 'owned/video-source';
const CANONICAL_TIMING_KEY = `video-timing-sha256:${CANONICAL_TIMING_SHA}`;
const MEMBER_SOURCE_KEY = 'owned/member-source';
const MEMBER_SHA = '34'.repeat(32);
const RENDER_SOURCE_KEY = 'owned/render-source';
const RENDER_SHA = '45'.repeat(32);

test('V18 retention authenticates the exact profile before traversing its scope', () => {
	let traps = 0;
	const scope = new Proxy({}, {
		get() { traps += 1; throw new Error('scope getter trap'); },
		getOwnPropertyDescriptor() { traps += 1; throw new Error('scope descriptor trap'); },
		getPrototypeOf() { traps += 1; throw new Error('scope prototype trap'); },
		ownKeys() { traps += 1; throw new Error('scope key trap'); },
	});
	assert.throws(
		() => collectFramescaperProjectStorageRootsV18({}, scope),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(traps, 0);
});

test('all-null V18 roots preserve canonical source and timing bodies without proxy roots', () => {
	const project = allNullProject();
	const roots = collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		scope(project),
	);
	assert.deepEqual(roots, [CANONICAL_SOURCE_KEY, CANONICAL_TIMING_KEY].sort());
	assert.equal(roots.some((key) => key.startsWith('video-proxy-sha256:')), false);
	assert.equal(Object.isFrozen(roots), true);
});

test('V18 roots multicamera member and rendered-fallback media that no clip reaches', () => {
	const project = dormantReferenceProject();
	const roots = collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		scope(project),
	);

	assert.deepEqual(roots, [
		CANONICAL_SOURCE_KEY, CANONICAL_TIMING_KEY, MEMBER_SOURCE_KEY, RENDER_SOURCE_KEY,
	].sort());
});

test('retention covers retained revisions, every history snapshot, pending saves, and both claim states', () => {
	const current = allNullProject();
	const retained = attachedProject('34', '45');
	const present = attachedProject('56', '67');
	const undo = attachedProject('78', '89');
	const redo = attachedProject('9a', 'ab');
	const pending = attachedProject('bc', 'cd');
	const provisional = claim('unverified', 'proxy', 'de');
	const verified = claim('verified', 'timing', 'ef');

	const roots = collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{
			currentProject: current,
			retainedRevisions: [{ revision: retained.revision, project: retained }],
			histories: [{
				limit: 2,
				present,
				undoStack: [{ project: undo, command: { type: 'retention-undo' } }],
				redoStack: [{ project: redo, command: { type: 'retention-redo' } }],
			}],
			pendingSaveSnapshots: new Set([pending]),
			claims: [provisional, verified],
		},
	);

	assert.deepEqual(roots, [...new Set([
		CANONICAL_SOURCE_KEY,
		CANONICAL_TIMING_KEY,
		...attachmentKeys(retained),
		...attachmentKeys(present),
		...attachmentKeys(undo),
		...attachmentKeys(redo),
		...attachmentKeys(pending),
		provisional.bodyKey,
		verified.bodyKey,
	])].sort());
	assert.equal(new Set(roots).size, roots.length);
});

test('an attachment body remains rooted until absent from every retention category', () => {
	const allNull = allNullProject();
	const attached = attachedProject('a1', 'b2');
	const [proxyKey, timingKey] = attachmentKeys(attached);
	const proxyClaim = claim('unverified', 'proxy', 'a1');
	const timingClaim = claim('verified', 'timing', 'b2');
	const categories = {
		currentProject: attached,
		retainedRevisions: [{ revision: attached.revision, project: attached }],
		histories: [{ limit: 1, present: attached, undoStack: [], redoStack: [] }],
		pendingSaveSnapshots: new Set([attached]),
		claims: [proxyClaim, timingClaim],
	};

	for (const value of [
		categories,
		{ ...categories, currentProject: allNull },
		{ ...categories, currentProject: allNull, retainedRevisions: [] },
		{ ...categories, currentProject: allNull, retainedRevisions: [], histories: [] },
		{ ...categories, currentProject: allNull, retainedRevisions: [], histories: [], pendingSaveSnapshots: new Set() },
	]) {
		const roots = collectFramescaperProjectStorageRootsV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			value,
		);
		assert.equal(roots.includes(proxyKey), true);
		assert.equal(roots.includes(timingKey), true);
	}
	const absent = collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{
			currentProject: allNull,
			retainedRevisions: [],
			histories: [],
			pendingSaveSnapshots: new Set(),
			claims: [],
		},
	);
	assert.equal(absent.includes(proxyKey), false);
	assert.equal(absent.includes(timingKey), false);
});

test('prior, future, malformed snapshots and claims fail closed before a result is exposed', () => {
	const project = allNullProject();
	const invalidCases: unknown[] = [
		{ ...scope(project), currentProject: { ...project, schemaVersion: 17 } },
		{ ...scope(project), currentProject: { schemaVersion: 19, future: true } },
		{
			...scope(project),
			retainedRevisions: [{ revision: Number(project.revision) + 1, project }],
		},
		{
			...scope(project),
			histories: [{ limit: 1, present: project, undoStack: [{
				project: { ...project, schemaVersion: 19 }, command: { type: 'future' },
			}], redoStack: [] }],
		},
		{ ...scope(project), claims: [{ ...claim('verified', 'proxy', 'c3'), extra: true }] },
	];
	for (const value of invalidCases) {
		assert.throws(() => collectFramescaperProjectStorageRootsV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			value,
		));
	}
});

test('aggregate input and unique-root limits hard-stop with no caller-owned partial target', () => {
	const project = attachedProject('d4', 'e5');
	assert.throws(() => collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		{
			...scope(project),
			retainedRevisions: [{ revision: project.revision, project }],
		},
		{ maximumInputs: 1, maximumRoots: 10 },
	), /aggregate.*input.*limit/iu);
	assert.throws(() => collectFramescaperProjectStorageRootsV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		scope(project),
		{ maximumInputs: 10, maximumRoots: 2 },
	), /storage root.*limit/iu);
});

function scope(currentProject: unknown) {
	return {
		currentProject,
		retainedRevisions: [],
		histories: [],
		pendingSaveSnapshots: new Set<unknown>(),
		claims: [],
	};
}

function allNullProject(): FramescaperProjectV18 {
	return createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-retention', title: 'Framescaper retention', now: NOW,
		sources: [createVideoSource({
			id: 'video-source', name: 'Video', storageKey: CANONICAL_SOURCE_KEY,
			mimeType: 'video/mp4', contentSha256: ORIGINAL_SHA,
			frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
			timingAsset: {
				encoding: 'soundscaper-video-timing-v1', storageKey: CANONICAL_TIMING_KEY,
				sha256: CANONICAL_TIMING_SHA, sourceSha256: ORIGINAL_SHA, byteLength: 112,
				frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
			},
			timingDecision: { mode: 'exact', rate: { num: 10, den: 1 } },
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
}

function dormantReferenceProject(): FramescaperProjectV18 {
	const project = allNullProject() as unknown as Record<string, unknown>;
	return createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: project.id, title: project.title, now: NOW,
		sources: [
			...project.sources as readonly unknown[],
			dormantSource('member-source', MEMBER_SOURCE_KEY, MEMBER_SHA),
			dormantSource('render-source', RENDER_SOURCE_KEY, RENDER_SHA),
		],
		clips: project.clips, tracks: project.tracks, sequences: project.sequences,
		primarySequenceId: project.primarySequenceId,
		multicameraGroups: [{
			id: 'multicamera-a', projectId: project.id, sequenceId: 'main-sequence',
			outputClipId: 'video-clip', activeMemberId: 'member-a', members: [
				{ id: 'member-a', groupId: 'multicamera-a', sourceId: 'video-source', syncOffsetSamples: 0 },
				{ id: 'member-b', groupId: 'multicamera-a', sourceId: 'member-source', syncOffsetSamples: 0 },
			],
		}],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher.film-grain', featureId: 'org.example.film-grain', displayName: 'Film grain',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-video-render-v1', kind: 'video',
				sourceId: 'render-source', sha256: RENDER_SHA,
			},
		}] },
	} as never);
}

function dormantSource(id: string, storageKey: string, contentSha256: string): unknown {
	return createVideoSource({
		id, name: id, storageKey, mimeType: 'video/mp4', contentSha256,
		frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
	});
}

function attachedProject(proxyPair: string, timingPair: string): FramescaperProjectV18 {
	const project = structuredClone(allNullProject()) as unknown as Record<string, unknown> & {
		sources: Record<string, unknown>[];
	};
	const proxySha = proxyPair.repeat(32);
	const timingSha = timingPair.repeat(32);
	project.sources[0]!.proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/mp4', byteLength: 123,
		sha256: proxySha, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${timingSha}`,
			sha256: timingSha, sourceSha256: proxySha, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = project.featureRequirements as { readonly requirements: readonly unknown[] };
	project.featureRequirements = {
		schemaVersion: 2,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return project as unknown as FramescaperProjectV18;
}

function attachmentKeys(project: FramescaperProjectV18): [string, string] {
	const source = project.sources[0];
	if (source?.kind !== 'video' || source.proxyAttachment === null) {
		throw new TypeError('The fixture requires an attachment.');
	}
	return [source.proxyAttachment.storageKey, source.proxyAttachment.timingAsset.storageKey];
}

function claim(
	status: 'unverified' | 'verified',
	bodyKind: 'proxy' | 'timing',
	digestPair: string,
): VideoProxyClaimRecord {
	const sha256 = digestPair.repeat(32);
	const bodyKey = `${bodyKind === 'proxy' ? 'video-proxy' : 'video-timing'}-sha256:${sha256}`;
	const operationId = `retention-${bodyKind}-${digestPair}`;
	return {
		key: videoProxyClaimKey(operationId, bodyKind, bodyKey),
		kind: 'video-proxy-claim', schemaVersion: 1, status,
		operationId, projectId: 'framescaper-retention', sourceId: 'video-source',
		baseFingerprint: 'f0'.repeat(32), bodyKind, bodyKey,
		generation: `generation-${bodyKind}-${digestPair}`,
		createdAt: 1, updatedAt: 2, expiresAt: 3,
		rowIdentity: {
			sourceId: bodyKey,
			kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
			encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
			storage: 'opfs', path: `proxy/${bodyKind}-${sha256}.bin`,
			mediaChunkToken: null, mediaChunkBytes: null, mediaChunkCount: null,
			mediaContentDigestVersion: 1,
			mediaContentToken: `media-content-retention-${bodyKind}-${digestPair}`,
			sha256, byteLength: bodyKind === 'proxy' ? 123 : 112,
			mimeType: bodyKind === 'proxy' ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
		},
	};
}
