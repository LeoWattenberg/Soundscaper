/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateAudioEditorProject } from '../src/common/editor/migration.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	cloneFramescaperProjectV18,
	createFramescaperProjectV18,
	loadFramescaperProjectV18,
	validateFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';
import {
	FramescaperProjectReimportRequiredError,
	migrateFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18-migration.ts';
import {
	framescaperProjectForCommandConsumersV18,
	framescaperProjectForRuntimeConsumersV18,
	prepareFramescaperPersistedProjectCommandDraftV18,
} from '../src/framescaper/editor-project-v18-runtime.ts';

const NOW = '2026-08-13T10:00:00.000Z';
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);

test('the isolated domain requires the exact Framescaper profile before project traversal', () => {
	let traps = 0;
	const project = new Proxy({}, { get() { traps += 1; throw new Error('project trap'); } });
	for (const operation of [
		() => validateFramescaperProjectV18({}, project),
		() => createFramescaperProjectV18({}, project),
		() => cloneFramescaperProjectV18({}, project),
		() => loadFramescaperProjectV18({}, project),
		() => migrateFramescaperProjectV18({}, project),
		() => framescaperProjectForRuntimeConsumersV18({}, project),
		() => framescaperProjectForCommandConsumersV18({}, project),
	] as const) assert.throws(operation, /exact Framescaper V18 runtime profile/iu);
	assert.equal(traps, 0);
});

test('V18 creation is an all-null additive successor without changing V17 globals', () => {
	const input = options();
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, input);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	assert.equal(project.schemaVersion, 18);
	assert.equal(project.sources[0]?.kind, 'video');
	assert.equal(project.sources[0]?.proxyAttachment, null);
	assert.equal(Object.hasOwn(project.sources[0]!, 'proxyAttachment'), true);
	assert.equal(validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, project), true);

	const v17 = createAudioEditorProjectV17(input);
	assert.equal(Object.hasOwn(v17.sources[0]!, 'proxyAttachment'), false);
	assert.deepEqual(migrateAudioEditorProject({ ...project }), {
		project,
		migrated: false,
		fromVersion: 18,
		readOnly: true,
		reason: 'newer-schema',
	});
});

test('V18 raw validation requires exact source attachment ownership and detached clones', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, options());
	const attached = withAttachment(project, attachment());
	assert.equal(validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, attached), true);
	const clone = cloneFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, attached);
	assert.deepEqual(clone, attached);
	assert.notStrictEqual(clone, attached);
	assert.notStrictEqual(clone.sources[0], attached.sources[0]);
	assert.notStrictEqual(clone.sources[0]?.proxyAttachment, attached.sources[0]?.proxyAttachment);
	assert.equal(Object.isFrozen(clone.sources[0]?.proxyAttachment), true);
	assert.equal(Object.isFrozen(
		(clone.sources[0]?.proxyAttachment as Readonly<{ timingAsset: object }>).timingAsset,
	), true);

	const missing = structuredClone(project) as Record<string, unknown>;
	delete ((missing.sources as Record<string, unknown>[])[0]!).proxyAttachment;
	assert.throws(() => validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, missing), /proxyAttachment.*own enumerable data/iu);
	const audioField = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'audio-v18', title: 'Audio', now: NOW,
		sources: [{ id: 'audio-source', kind: 'audio', name: 'Audio', storageKey: 'audio-source',
			mimeType: 'audio/wav', frameCount: 10, channelCount: 1, sampleRate: 48_000,
			proxyAttachment: null }],
	});
	assert.equal(Object.hasOwn(audioField.sources[0]!, 'proxyAttachment'), false);
	const polluted = structuredClone(audioField) as Record<string, unknown>;
	(polluted.sources as Record<string, unknown>[])[0]!.proxyAttachment = null;
	assert.throws(() => validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, polluted), /audio.*proxyAttachment/iu);
});

test('attached V18 validates source, occurrence, timing, retime, collision, and shared-body invariants', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, options());
	for (const [mutate, message] of [
		[(value: ReturnType<typeof attachment>) => { value.originalSha256 = '78'.repeat(32); }, /original.*digest/iu],
		[(value: ReturnType<typeof attachment>) => { value.frameCount = 11; value.boundaryCount = 12; }, /frame count/iu],
	] as const) {
		const value = attachment();
		mutate(value);
		assert.throws(() => validateFramescaperProjectV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			withAttachment(project, value),
		), message);
	}
	const retimed = withAttachment(project, attachment());
	(retimed.clips[0] as Record<string, unknown>).retimeMap = {
		feature: 'video-retime-v2', version: 2, outerFrameCount: 10,
		points: [{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } }, { outerFrame: 10, sourceFrame: { num: 10, den: 1 } }],
		segments: [{ mode: 'constant' }],
	};
	assert.throws(() => validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, retimed), /retimeMap.*null/iu);
	const orphan = withAttachment(project, attachment());
	orphan.clips = [];
	orphan.tracks = [{ ...orphan.tracks[0], clipIds: [] }];
	assert.throws(() => validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, orphan), /occurrence/iu);
	const collision = withAttachment(project, attachment());
	collision.sources[0]!.storageKey = `video-proxy-sha256:${PROXY_SHA}`;
	assert.throws(
		() => validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, collision),
		/collides with canonical source identity/iu,
	);
});

test('V18 load and migration distinguish all-null, attached, prior, and opaque future schemas', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, options());
	assert.deepEqual(loadFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, project), {
		project, readOnly: false, intrinsicReadOnly: false, reason: null,
	});
	const attached = withAttachment(project, attachment());
	assert.deepEqual(loadFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, attached), {
		project: attached, readOnly: true, intrinsicReadOnly: true, reason: 'proxy-attached',
	});
	const future = { schemaVersion: 19, future: { retained: true } };
	assert.deepEqual(migrateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, future), {
		project: future, migrated: false, fromVersion: 19,
		readOnly: true, intrinsicReadOnly: true, reason: 'newer-schema',
	});

	let nestedTraps = 0;
	const v17 = { schemaVersion: 17, sources: new Proxy([], {
		get() { nestedTraps += 1; throw new Error('nested trap'); },
	}) };
	assert.throws(
		() => migrateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, v17),
		(error: unknown) => error instanceof FramescaperProjectReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED'
			&& error.schemaVersion === 17
			&& error.currentSchemaVersion === 18,
	);
	assert.equal(nestedTraps, 0);

	let futureGetterCalls = 0;
	const hostileFuture = { schemaVersion: 19 } as Record<string, unknown>;
	Object.defineProperty(hostileFuture, 'future', {
		enumerable: true,
		get() { futureGetterCalls += 1; return true; },
	});
	assert.throws(
		() => loadFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, hostileFuture),
		/own enumerable data property/iu,
	);
	assert.equal(futureGetterCalls, 0);
});

test('V18 runtime and command projections preserve attachment authority and reconcile all-null drafts', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, options());
	const runtime = framescaperProjectForRuntimeConsumersV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, project);
	const command = framescaperProjectForCommandConsumersV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, project);
	assert.equal(runtime.schemaVersion, 17);
	assert.equal(Object.hasOwn(runtime.sources[0] ?? {}, 'proxyAttachment'), false);
	assert.equal(command.sources[0]?.proxyAttachment, null);
	assert.notStrictEqual(command, project);

	const draft = structuredClone(command) as Record<string, unknown>;
	prepareFramescaperPersistedProjectCommandDraftV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		draft,
		project,
	);
	assert.equal(draft.schemaVersion, 18);
	assert.equal((draft.sources as Record<string, unknown>[])[0]?.proxyAttachment, null);
	assert.equal(validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, draft), true);

	const attached = withAttachment(project, attachment());
	const attachedCommand = framescaperProjectForCommandConsumersV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		attached,
	) as unknown as Record<string, unknown>;
	((attachedCommand.sources as Record<string, unknown>[])[0]!).proxyAttachment = null;
	assert.throws(() => prepareFramescaperPersistedProjectCommandDraftV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		attachedCommand,
		attached,
	), /changed.*proxy attachment authority/iu);
});

function options(): Record<string, unknown> {
	return {
		id: 'framescaper-v18', title: 'Framescaper V18', now: NOW,
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true })],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	};
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4', byteLength: 123,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${TIMING_SHA}`,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function withAttachment(
	project: ReturnType<typeof createFramescaperProjectV18>,
	value: Record<string, unknown>,
): Record<string, unknown> & {
	sources: Record<string, unknown>[];
	clips: Record<string, unknown>[];
	tracks: Record<string, unknown>[];
} {
	const result = structuredClone(project) as unknown as Record<string, unknown> & {
		sources: Record<string, unknown>[];
		clips: Record<string, unknown>[];
		tracks: Record<string, unknown>[];
	};
	result.sources[0].proxyAttachment = value;
	const requirements = (result.featureRequirements as { requirements: readonly unknown[] }).requirements;
	result.featureRequirements = {
		schemaVersion: 2,
		requirements: [...requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return result;
}
