/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoFramescaperHandoffProjectV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-project-v1.ts';
import { cloneFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoColorContextV1 } from '../src/common/editor/video-color-management-v27.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

const IDENTITY = Object.freeze({ projectId: 'handoff-project', sequenceId: 'handoff-sequence', trackId: 'handoff-track', clipId: 'handoff-clip', now: '2026-10-10T00:00:00.000Z' });

for (const processVersion of [1, 2] as const) test(`Light handoff creates a genuine editable Frame project for saved process${processVersion}`, () => {
	const f = editableImageFixture({ processVersion, ...(processVersion === 2 ? { cube: false } : {}) }), before = structuredClone(f.source);
	const project = createPhotoFramescaperHandoffProjectV1(f.source, IDENTITY);
	assert.equal(validateFramescaperProject(PROFILE, project), true); assert.deepEqual(cloneFramescaperProject(PROFILE, project), project);
	assert.equal(project.id, IDENTITY.projectId); assert.equal(project.title, f.source.name);
	assert.equal(project.sources.length, 1); assert.deepEqual(project.sources[0], f.source); assert.deepEqual(f.source, before);
	assert.equal(project.clips.length, 1); assert.deepEqual(project.clips[0], { schemaVersion: 1, kind: 'image', id: IDENTITY.clipId, sourceId: f.source.id,
		sequenceId: IDENTITY.sequenceId, sequenceStartFrame: 0, sequenceFrameCount: 30, sourceStartTicks: '0' });
	assert.deepEqual(project.tracks[0]!.clipIds, [IDENTITY.clipId]); assert.deepEqual(project.projectBin.clips, []);
	assert.equal(project.primarySequenceId, IDENTITY.sequenceId); assert.deepEqual(project.sequences[0]!.rate, { num: 30, den: 1 });
	assert.ok(Array.isArray(project.videoColorContexts)); assert.equal(normalizeVideoColorContextV1(project.videoColorContexts[0]).outputSpace, 'srgb');
});

test('Light project assembly detaches the selected source and refuses future or animated source authority', () => {
	const f = editableImageFixture();
	assert.throws(() => createPhotoFramescaperHandoffProjectV1({ ...f.source, schemaVersion: 3 }, IDENTITY));
	assert.throws(() => createPhotoFramescaperHandoffProjectV1({ ...f.source, canonical: { ...f.source.canonical, frameCount: 2 } }, IDENTITY), /still|single|static/iu);
	const project = createPhotoFramescaperHandoffProjectV1(f.source, IDENTITY);
	assert.notEqual(project.sources[0], f.source); assert.deepEqual(project.sources[0], f.source);
});

test('Light project identity is closed own data and refuses colliding identifiers without invoking getters', () => {
	const f = editableImageFixture(); let getters = 0;
	const bad = Object.defineProperty({ ...IDENTITY }, 'projectId', { enumerable: true, get() { getters++; return IDENTITY.projectId; } });
	assert.throws(() => createPhotoFramescaperHandoffProjectV1(f.source, bad));
	assert.throws(() => createPhotoFramescaperHandoffProjectV1(f.source, { ...IDENTITY, trackId: IDENTITY.clipId }), /distinct|collision/iu);
	assert.throws(() => createPhotoFramescaperHandoffProjectV1(f.source, { ...IDENTITY, now: 'invalid' })); assert.equal(getters, 0);
});
