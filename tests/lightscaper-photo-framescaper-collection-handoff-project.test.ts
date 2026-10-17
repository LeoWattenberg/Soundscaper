/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoFramescaperCollectionHandoffProjectV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-project-v1.ts';
import { cloneFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { normalizeVideoColorContextV1 } from '../src/common/editor/video-color-management-v27.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

const IDENTITY = Object.freeze({ projectId: 'collection-project', sequenceId: 'collection-sequence', trackId: 'collection-track',
	clipIds: Object.freeze(['clip-first', 'clip-second']), name: 'Café collection', now: '2026-10-11T00:00:00.000Z' });

function sources() {
	return [editableImageFixture({ sourceId: 'source-first', processVersion: 1, crop: false }).source,
		editableImageFixture({ sourceId: 'source-second', processVersion: 2, cube: false }).source];
}

function imageClips(project: ReturnType<typeof createPhotoFramescaperCollectionHandoffProjectV1>) {
	return project.clips.map(clip => { if (clip.kind !== 'image') throw new Error('Every collection placement must be an image.'); return clip; });
}

test('Light collection assembles an ordinary current Frame sequence in selected order without collapsing shared originals', () => {
	const input = sources(), before = structuredClone(input);
	assert.equal(input[0]!.original.sha256, input[1]!.original.sha256);
	const project = createPhotoFramescaperCollectionHandoffProjectV1(input, IDENTITY);
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	assert.deepEqual(cloneFramescaperProject(PROFILE, project), project);
	assert.equal(project.title, IDENTITY.name); assert.equal(project.id, IDENTITY.projectId);
	assert.deepEqual(project.sources, before); assert.deepEqual(input, before);
	assert.deepEqual(imageClips(project).map(clip => ({ id: clip.id, sourceId: clip.sourceId, sequenceId: clip.sequenceId,
		start: clip.sequenceStartFrame, count: clip.sequenceFrameCount, sourceStart: clip.sourceStartTicks })), [
		{ id: 'clip-first', sourceId: 'source-first', sequenceId: IDENTITY.sequenceId, start: 0, count: 30, sourceStart: '0' },
		{ id: 'clip-second', sourceId: 'source-second', sequenceId: IDENTITY.sequenceId, start: 30, count: 30, sourceStart: '0' },
	]);
	assert.deepEqual(project.tracks[0]!.clipIds, IDENTITY.clipIds); assert.deepEqual(project.projectBin.clips, []);
	assert.equal(project.primarySequenceId, IDENTITY.sequenceId); assert.deepEqual(project.sequences[0]!.rate, { num: 30, den: 1 });
	assert.deepEqual(project.sequences[0]!.trackIds, [IDENTITY.trackId]);
	assert.ok(Array.isArray(project.videoColorContexts));
	assert.equal(normalizeVideoColorContextV1(project.videoColorContexts[0]).outputSpace, 'srgb');
	assert.notEqual(project.sources[0], input[0]); assert.notEqual(project.sources[1], input[1]);
});

test('Light collection places fractional canonical durations contiguously with exact integer ceiling', () => {
	const input = ['50000', '1000000', '1'].map((durationTicks, index) => {
		const source = editableImageFixture({ sourceId: `source-${String(index)}` }).source;
		return normalizeFramescaperImageSourceV2({ ...source, canonical: { ...source.canonical, durationTicks } });
	});
	const project = createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, clipIds: ['clip-a', 'clip-b', 'clip-c'] });
	assert.deepEqual(imageClips(project).map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount]), [[0, 2], [2, 30], [32, 1]]);
});

test('Light collection retains the current Frame clip-duration ceiling for an otherwise admitted long still', () => {
	const source = sources()[0]!;
	const longStill = normalizeFramescaperImageSourceV2({ ...source, canonical: { ...source.canonical, durationTicks: '86400000000' } });
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([longStill], { ...IDENTITY, clipIds: ['clip-first'] }), /frame|sequence/iu);
});

test('Light collection refuses empty, sparse, oversized or accessor-backed selection and clip identities without invoking getters', () => {
	const input = sources(); let getters = 0;
	const badSources = [...input]; Object.defineProperty(badSources, '0', { enumerable: true, get() { getters++; return input[0]; } });
	const badIds = [...IDENTITY.clipIds]; Object.defineProperty(badIds, '1', { enumerable: true, get() { getters++; return IDENTITY.clipIds[1]; } });
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([], { ...IDENTITY, clipIds: [] }));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(new Array(2), IDENTITY));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(new Array(4095), { ...IDENTITY, clipIds: new Array(4095) }));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(badSources, IDENTITY));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, clipIds: badIds }));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, clipIds: ['clip-only'] }));
	assert.equal(getters, 0);
});

test('Light collection rejects all source, clip and container identifier collisions before project assembly', () => {
	const input = sources();
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([input[0], input[0]], IDENTITY), /distinct|collision/iu);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, clipIds: ['same', 'same'] }), /distinct|collision/iu);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, trackId: IDENTITY.sequenceId }), /distinct|collision/iu);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, clipIds: ['source-first', 'other'] }), /distinct|collision/iu);
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, projectId: 'source-second' }), /distinct|collision/iu);
});

test('Light collection refuses legacy, future and animated source authority and unsafe identity data', () => {
	const input = sources(), one = { ...IDENTITY, clipIds: ['clip-first'] }; let getters = 0;
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([{ ...input[0], schemaVersion: 1 }], one));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([{ ...input[0], schemaVersion: 3 }], one));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1([{ ...input[0], canonical: { ...input[0]!.canonical, frameCount: 2 } }], one));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, now: 'invalid' }));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, { ...IDENTITY, name: '' }));
	assert.throws(() => createPhotoFramescaperCollectionHandoffProjectV1(input, Object.defineProperty({ ...IDENTITY }, 'name', {
		enumerable: true, get() { getters++; return IDENTITY.name; },
	})));
	assert.equal(getters, 0);
});
