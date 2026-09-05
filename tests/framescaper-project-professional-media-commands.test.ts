/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnreportedVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_HEADER_BYTES,
} from '../src/common/editor/video-timing-asset-reference.ts';
import {
	FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from '../src/framescaper/editor-project-professional-media.ts';
import {
	applyFramescaperProjectCommandProfessionalMedia,
	createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia,
	framescaperProfessionalSourceStateProfessionalMedia,
	snapshotFramescaperProjectCommandProfessionalMedia,
	type FramescaperProfessionalSourceStateProfessionalMedia,
	type FramescaperProfessionalSourceStateSetCommandProfessionalMedia,
	type FramescaperProjectCommandBatchProfessionalMedia,
} from '../src/framescaper/editor-project-professional-media-commands.ts';
import {
	createFramescaperProfessionalMediaClipboardV9,
} from '../src/framescaper/editor-session-clipboard-v9.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { professionalProject } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

const NOW = '2026-09-05T10:00:00.000Z';
const ORIGINAL_SHA256 = '12'.repeat(32);
const PROXY_SHA256 = 'ab'.repeat(32);
const TIMING_SHA256 = 'cd'.repeat(32);
const FRAME_COUNT = 10;
const TRACK_UPDATE = Object.freeze({ type: 'track/update', trackId: 'audio-track', changes: { mute: true } });

test('a professional state set replaces the source facts and advances the bookkeeping once', () => {
	const project = plainProject();
	const state = {
		characteristics: reportedCharacteristics(),
		imageSequence: null,
		proxyAttachment: proxyAttachment(),
	};

	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: currentState(project),
		state,
	}, { now: NOW });

	const source = videoSource(updated);
	assert.equal((source.characteristics as VideoSourceCharacteristicsV25).bitDepth, 10);
	assert.equal((source.proxyAttachment as Data).sha256, PROXY_SHA256);
	assert.equal(updated.revision, 1);
	assert.equal(updated.updatedAt, NOW);
	// The caller's project is an input, never the mutation target.
	assert.equal(videoSource(project).proxyAttachment, null);
	assert.equal(project.revision, 0);
});

test('a professional state set refuses an expected state that no longer matches the source', () => {
	const project = plainProject();

	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: { ...currentState(project), characteristics: reportedCharacteristics() },
		state: { ...currentState(project), proxyAttachment: proxyAttachment() },
	}, { now: NOW }), /expected professionalMedia professional source state is stale/u);
	assert.equal(videoSource(project).proxyAttachment, null);
});

test('a professional state set names a video source that has to exist', () => {
	const project = plainProject();

	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'missing-source',
		expectedState: currentState(project),
		state: currentState(project),
	}), ReferenceError);
	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'audio-source',
		expectedState: currentState(project),
		state: currentState(project),
	}), ReferenceError);
});

test('a professional state set refuses an image sequence that contradicts the new characteristics', () => {
	const project = professionalProject();
	const state = currentState(project);

	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: state,
		state: { ...state, characteristics: reportedCharacteristics() },
	}, { now: NOW }), /image-sequence descriptor must use its owning source characteristics/u);
});

test('a professional state set can retire the image sequence of a source it keeps', () => {
	const project = professionalProject();
	const state = currentState(project);

	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: state,
		state: { ...state, imageSequence: null },
	}, { now: NOW });

	assert.equal(videoSource(updated).imageSequence, null);
	assert.deepEqual(videoSource(updated).characteristics, videoSource(project).characteristics);
	assert.notEqual(videoSource(project).imageSequence, null);
	assert.equal(updated.revision, 1);
});

test('an admission adds one professional source and refuses a second admission of that identity', () => {
	const project = plainProject();
	const admitted = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-add', source: extraVideoSource(),
	}, { now: NOW });

	assert.deepEqual(admitted.sources.map(({ id }) => id), ['video-source', 'audio-source', 'second-source']);
	assert.equal(admitted.revision, 1);
	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, admitted, {
		type: 'video-source/professional-add', source: extraVideoSource(),
	}, { now: NOW }), /already exists or is stale/u);
});

test('a removal drops the named source and refuses a stale expectation of it', () => {
	const admitted = applyFramescaperProjectCommandProfessionalMedia(PROFILE, plainProject(), {
		type: 'video-source/professional-add', source: extraVideoSource(),
	}, { now: NOW });
	const expectedSource = admitted.sources.find(({ id }) => id === 'second-source')!;

	const removed = applyFramescaperProjectCommandProfessionalMedia(PROFILE, admitted, {
		type: 'video-source/professional-remove', sourceId: 'second-source', expectedSource,
	}, { now: NOW });

	assert.deepEqual(removed.sources.map(({ id }) => id), ['video-source', 'audio-source']);
	assert.equal(removed.revision, 2);
	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, admitted, {
		type: 'video-source/professional-remove',
		sourceId: 'second-source',
		expectedSource: { ...(expectedSource as Data), name: 'Renamed' },
	}, { now: NOW }), /expected professionalMedia professional source is stale/u);
});

test('a batch applies every child in order and advances the revision exactly once', () => {
	const project = plainProject();
	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'batch',
		commands: [
			{ type: 'video-source/professional-add', source: extraVideoSource() },
			{
				type: 'video-source/professional-state-set',
				sourceId: 'video-source',
				expectedState: currentState(project),
				state: { ...currentState(project), proxyAttachment: proxyAttachment() },
			},
		],
	}, { now: NOW });

	assert.deepEqual(updated.sources.map(({ id }) => id), ['video-source', 'audio-source', 'second-source']);
	assert.equal((videoSource(updated).proxyAttachment as Data).frameCount, FRAME_COUNT);
	assert.equal(updated.revision, 1);
	assert.equal(updated.updatedAt, NOW);
});

test('an inherited visual command is applied through the visual authority and keeps the image sequence', () => {
	const project = professionalProject();
	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, TRACK_UPDATE, { now: NOW });

	const track = (updated.tracks as Data[]).find(({ id }) => id === 'audio-track') as Data;
	assert.equal(track.mute, true);
	assert.equal((videoSource(updated).imageSequence as Data).id, 'video-source');
	assert.equal(updated.revision, 1);
});

test('an inherited visual command nested in a batch reaches the visual authority too', () => {
	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, plainProject(), {
		type: 'batch', commands: [{ type: 'batch', commands: [TRACK_UPDATE] }],
	}, { now: NOW });

	assert.equal(((updated.tracks as Data[]).find(({ id }) => id === 'audio-track') as Data).mute, true);
	assert.equal(updated.revision, 1);
});

test('an unparsable now option refuses the command instead of stamping an invalid timestamp', () => {
	const project = plainProject();

	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-add', source: extraVideoSource(),
	}, { now: 'the day before yesterday' }), /timestamp is invalid/u);
});

test('a source admission refuses to advance a revision that has run out of safe integers', () => {
	const project = structuredClone(plainProject()) as unknown as Data;
	project.revision = Number.MAX_SAFE_INTEGER;

	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, {
		type: 'video-source/professional-add', source: extraVideoSource(),
	}, { now: NOW }), /revision overflowed/u);
});

test('an omitted now option stamps the current wall clock', () => {
	const before = Date.now();
	const updated = applyFramescaperProjectCommandProfessionalMedia(PROFILE, plainProject(), {
		type: 'video-source/professional-add', source: extraVideoSource(),
	});

	const stamped = new Date(String(updated.updatedAt)).getTime();
	assert.equal(Number.isNaN(stamped), false);
	assert.ok(stamped >= before, `${String(updated.updatedAt)} is not at or after the call`);
});

test('applying a command asserts the runtime profile before it reads the project', () => {
	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia({}, plainProject(), TRACK_UPDATE));
	assert.throws(() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, { schemaVersion: 3 }, TRACK_UPDATE), RangeError);
});

test('the professional state reader returns the frozen detached facts of one video source', () => {
	const project = professionalProject();
	const state = framescaperProfessionalSourceStateProfessionalMedia(PROFILE, project, 'video-source');

	assert.equal(Object.isFrozen(state), true);
	assert.deepEqual(state.characteristics, videoSource(project).characteristics);
	assert.equal((state.imageSequence as unknown as Data).id, 'video-source');
	assert.equal(state.proxyAttachment, null);
	assert.notStrictEqual(state.characteristics, videoSource(project).characteristics);
});

test('the professional state reader refuses a missing source and a malformed source ID', () => {
	const project = plainProject();

	assert.throws(() => framescaperProfessionalSourceStateProfessionalMedia(PROFILE, project, 'missing-source'), ReferenceError);
	assert.throws(() => framescaperProfessionalSourceStateProfessionalMedia(PROFILE, project, 'audio-source'), ReferenceError);
	assert.throws(() => framescaperProfessionalSourceStateProfessionalMedia(PROFILE, project, '-leading-dash'), TypeError);
	assert.throws(() => framescaperProfessionalSourceStateProfessionalMedia(PROFILE, project, 7), TypeError);
});

test('snapshotting a professional state command deep-clones and freezes it away from the caller', () => {
	const characteristics = reportedCharacteristics() as unknown as Data;
	const command = snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: { characteristics, imageSequence: null, proxyAttachment: null },
		state: { characteristics, imageSequence: null, proxyAttachment: null },
	});
	characteristics.bitDepth = 32;

	assert.equal(command.type, 'video-source/professional-state-set');
	assert.equal(Object.isFrozen(command), true);
	const state: FramescaperProfessionalSourceStateProfessionalMedia =
		(command as FramescaperProfessionalSourceStateSetCommandProfessionalMedia).state;
	assert.equal(state.characteristics.bitDepth, 10);
});

test('snapshotting a professional state command refuses unknown fields and missing state', () => {
	const state = { characteristics: reportedCharacteristics(), imageSequence: null, proxyAttachment: null };

	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-state-set', sourceId: 'video-source', expectedState: state, state, extra: 1,
	}), TypeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-state-set', sourceId: 'video-source', state,
	}), TypeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-state-set',
		sourceId: 'video-source',
		expectedState: { ...state, unexpected: null },
		state,
	}), TypeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-state-set', sourceId: 'video source', expectedState: state, state,
	}), TypeError);
});

test('snapshotting refuses a malformed command and carries an unowned type to the inherited generations', () => {
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia(null), TypeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia([TRACK_UPDATE]), TypeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({ type: 7 }), TypeError);
	// An unowned type is carried opaquely to the inherited generations, which refuse it on apply.
	assert.equal(snapshotFramescaperProjectCommandProfessionalMedia({ type: 'nonsense/command' }).type, 'nonsense/command');
	assert.throws(
		() => applyFramescaperProjectCommandProfessionalMedia(PROFILE, plainProject(), { type: 'nonsense/command' }),
		Error,
	);
});

test('snapshotting routes collection commands through the professional source authority', () => {
	const added = snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-add', source: extraVideoSource(),
	});

	assert.equal(added.type, 'video-source/professional-add');
	assert.equal(Object.isFrozen(added), true);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({
		type: 'video-source/professional-remove', sourceId: 'other-source', expectedSource: extraVideoSource(),
	}), /cannot change source identity/u);
});

test('snapshotting refuses an empty batch, a cyclic batch and an over-deep batch', () => {
	const cyclic: Data = { type: 'batch', commands: [] };
	(cyclic.commands as unknown[]).push(cyclic);

	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia({ type: 'batch', commands: [] }), RangeError);
	assert.throws(() => snapshotFramescaperProjectCommandProfessionalMedia(cyclic), /Cyclic professionalMedia command batches/u);
	assert.throws(
		() => snapshotFramescaperProjectCommandProfessionalMedia(nestedBatches(130, TRACK_UPDATE)),
		/exceeds its depth limit/u,
	);
});

test('snapshotting refuses a batch tree wider than the traversal node budget', () => {
	const chain = nestedBatches(120, TRACK_UPDATE);
	const wide = { type: 'batch', commands: Array.from({ length: 900 }, () => chain) };

	assert.throws(
		() => snapshotFramescaperProjectCommandProfessionalMedia(wide),
		/professionalMedia command tree exceeds its limit/u,
	);
	assert.throws(
		() => snapshotFramescaperProjectCommandProfessionalMedia({
			type: 'batch', commands: Array.from({ length: 100_001 }, () => TRACK_UPDATE),
		}),
		/batch.commands requires 1 through 100000 entries/u,
	);
});

test('a clipboard paste becomes a frozen batch of admissions under the caller-allocated identities', () => {
	const project = plainProject();
	const clipboard = createFramescaperProfessionalMediaClipboardV9(PROFILE, project, ['video-source']);
	const command: FramescaperProjectCommandBatchProfessionalMedia =
		createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia(clipboard, {
			sourceIdMap: new Map([['video-source', 'pasted-source']]),
		});

	assert.equal(command.type, 'batch');
	assert.equal(Object.isFrozen(command), true);
	assert.equal(Object.isFrozen(command.commands), true);
	assert.deepEqual(command.commands.map((child) => child.type), ['video-source/professional-add']);

	const pasted = applyFramescaperProjectCommandProfessionalMedia(PROFILE, project, command, { now: NOW });
	assert.deepEqual(pasted.sources.map(({ id }) => id), ['video-source', 'audio-source', 'pasted-source']);
	assert.equal(pasted.revision, 1);
});

test('a clipboard paste refuses an unmapped source and an allocation map that is not a map', () => {
	const clipboard = createFramescaperProfessionalMediaClipboardV9(PROFILE, plainProject(), ['video-source']);

	assert.throws(() => createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia(clipboard, {
		sourceIdMap: new Map([['other-source', 'pasted-source']]),
	}), ReferenceError);
	assert.throws(() => createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia(clipboard, {
		sourceIdMap: {} as never,
	}), TypeError);
	assert.throws(() => createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia({ schemaVersion: 8 }, {
		sourceIdMap: new Map([['video-source', 'pasted-source']]),
	}), TypeError);
});

function plainProject(): FramescaperProjectProfessionalMedia {
	return createFramescaperProjectProfessionalMedia(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
}

function videoSource(project: FramescaperProjectProfessionalMedia): Data {
	return project.sources.find(({ id }) => id === 'video-source') as Data;
}

function currentState(project: FramescaperProjectProfessionalMedia): Data {
	const source = videoSource(project);
	return structuredClone({
		characteristics: source.characteristics,
		imageSequence: source.imageSequence,
		proxyAttachment: source.proxyAttachment,
	}) as Data;
}

function extraVideoSource(): Data {
	const source = structuredClone(videoSource(plainProject()));
	source.id = 'second-source';
	source.name = 'Second';
	return source;
}

function reportedCharacteristics(): VideoSourceCharacteristicsV25 {
	return { ...createUnreportedVideoSourceCharacteristicsV25(), bitDepth: 10 };
}

function proxyAttachment(): Data {
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA256}`,
		mimeType: 'video/mp4',
		byteLength: 4_096,
		sha256: PROXY_SHA256,
		originalSha256: ORIGINAL_SHA256,
		originalAuthorityKind: 'owned',
		generatorId: 'generator',
		generatorVersion: 1,
		recipeId: 'recipe',
		recipeVersion: 1,
		timingBackendId: 'exact-probe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT,
		boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: VIDEO_TIMING_ASSET_ENCODING,
			storageKey: `video-timing-sha256:${TIMING_SHA256}`,
			sha256: TIMING_SHA256,
			sourceSha256: PROXY_SHA256,
			byteLength: VIDEO_TIMING_ASSET_HEADER_BYTES + FRAME_COUNT * 8,
			frameCount: FRAME_COUNT,
			timescale: 1_000,
			finalFrameDurationTicks: '40',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

/** One chain of `depth` batches wrapped around a single leaf command. */
function nestedBatches(depth: number, leaf: unknown): unknown {
	let node = leaf;
	for (let index = 0; index < depth; index += 1) node = { type: 'batch', commands: [node] };
	return node;
}
