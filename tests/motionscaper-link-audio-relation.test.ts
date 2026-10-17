/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperCompositionLink, normalizeFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { migrateFramescaperSuccessorProject, normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { openFramescaperCompositionLinkOwnerRepository } from '../src/framescaper/editor-composition-link-owner-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function fixture() {
	const snapshot = createMotionscaperRevision(createMotionscaperProject({ id: 'motion', title: 'Scene', compositionId: 'main', durationFrames: 3 }));
	const video = createFramescaperCompositionSource({ sourceId: 'video', sampleRate: 48000, offer: createMotionCompositionOffer('main', snapshot) });
	const audio = createAudioSource({ id: 'audio', name: 'Composition PCM', frameCount: 4800, sampleRate: 48000, channelCount: 2, storageKey: 'motion-composition-pcm:audio' });
	const project = migrateFramescaperSuccessorProject(createFramescaperProject(undefined, { sources: [video.source, audio] }));
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	return { project, snapshot, video, audio, sources };
}
test('one composition relation can retain a distinct companion PCM leaf while old video-only JSON remains unchanged', () => {
	const { project, snapshot, sources } = fixture(); const link = createFramescaperCompositionLink('video', 'main', snapshot, { audioSourceId: 'audio' });
	assert.equal(normalizeFramescaperCompositionLink(link).audioSourceId, 'audio');
	assert.equal(normalizeFramescaperSuccessorProject({ ...project, compositionLinks: [link] }).compositionLinks[0]!.audioSourceId, 'audio');
	assert.equal(Object.hasOwn(createFramescaperCompositionLink('video', 'main', snapshot), 'audioSourceId'), false);
	assert.throws(() => createFramescaperCompositionLink('video', 'main', snapshot, { audioSourceId: 'video' }), /distinct|same/u);
	assert.throws(() => normalizeFramescaperSuccessorProject({ ...project, sources: [sources[0]], compositionLinks: [link] }), /audio|companion/u);
	assert.throws(() => normalizeFramescaperSuccessorProject({ ...project, compositionLinks: [{ ...link, audioSourceId: 'video' }] }), /distinct|same/u);
});
test('companion PCM ownership cannot collide with another linked leaf or silently attach to an encoded video source', () => {
	const { snapshot, sources } = fixture(); const first = createFramescaperCompositionLink('video', 'main', snapshot, { audioSourceId: 'audio' });
	const secondSource = createFramescaperCompositionSource({ sourceId: 'second', sampleRate: 48000, offer: createMotionCompositionOffer('main', snapshot) });
	const second = createFramescaperCompositionLink('second', 'main', snapshot, { audioSourceId: 'audio' });
	const both = migrateFramescaperSuccessorProject(createFramescaperProject(undefined, { sources: [...sources, secondSource.source] }));
	assert.throws(() => normalizeFramescaperSuccessorProject({ ...both, compositionLinks: [first, second] }), /unique|owned|audio/u);
	assert.throws(() => normalizeFramescaperSuccessorProject({ ...both, compositionLinks: [{ ...first, audioSourceId: 'second' }] }), /audio|companion/u);
});
test('the single atomic receiver receipt owns both leaves and persists that relation across close and reopen', async () => {
	const { project, snapshot } = fixture(); const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const owner = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	const prepared = await owner.prepareReceive(project.id, 'video', createMotionCompositionOffer('main', snapshot), { readAsset: async () => null });
	const linked = normalizeFramescaperSuccessorProject({ ...project, compositionLinks: [createFramescaperCompositionLink('video', 'main', snapshot, { audioSourceId: 'audio' })] });
	const saved = await prepared.commit({ project: linked, expectedOwnerDigest: null }); await owner.close();
	const reopened = await openFramescaperCompositionLinkOwnerRepository({ indexedDB, line: 'successor' });
	try { const loaded = await reopened.loadOwner(project.id); assert.deepEqual(loaded, saved); assert.equal(loaded!.linkStates.length, 1); assert.equal(loaded!.project.compositionLinks[0]!.audioSourceId, 'audio'); }
	finally { await reopened.close(); }
});
