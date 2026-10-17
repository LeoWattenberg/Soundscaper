/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { createMixRenderService, type MixRenderServiceDependencies } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-service.ts';
import { createImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import { findControllerSource, type ControllerSourceInventory } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { cloneFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { rebindFramescaperSourceIdentitiesTimelineImage } from '../src/framescaper/editor-project-timeline-image-source-rebind.ts';
import { editableImageFixture, openEditableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const processVersion of [1, 2] as const) test(`current command publication and clone retain the complete Photo${processVersion} editable source`, () => {
	const f = editableImageFixture({ processVersion }), project = f.project(), before = structuredClone(project);
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	assert.deepEqual(cloneFramescaperProject(PROFILE, project), before);
	const rebound = structuredClone(project);
	rebindFramescaperSourceIdentitiesTimelineImage(rebound as unknown as Record<string, unknown>, new Map([[f.source.id, 'rebound-source']]));
	const source = rebound.sources.find(row => row.kind === 'image'); assert.ok(source);
	assert.equal(source.id, 'rebound-source'); assert.equal(source.storageKey, 'rebound-source');
	assert.deepEqual(source.develop, f.source.develop); assert.deepEqual(source.provenance, f.source.provenance);
	assert.deepEqual(project, before); assert.deepEqual(f.calls, []);
});

test('current source replacement retains strict expected-source CAS and refuses future or foreign accessor facts before I/O', () => {
	const f = editableImageFixture(), project = f.project(); let getters = 0;
	for (const source of [{ ...f.source, schemaVersion: 3 }, Object.defineProperty({ ...f.source }, 'develop', { enumerable: true, get() { getters++; return f.source.develop; } })]) {
		assert.throws(() => applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: f.source.id, expectedSource: f.source, source }));
	}
	assert.equal(getters, 0); assert.deepEqual(f.calls, []);
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: f.source.id, expectedSource: { ...f.source, name: 'stale' }, source: f.source }), /stale/u);
});

// This heterogeneous controller inventory accepts actual selected image facts,
// while each existing scalar remains statically typed. Audio narrowing stays
// in the established PCM owner rather than interpreting image provenance.
test('current image inventory preserves visual provenance without broadening PCM fields', () => {
	const f = editableImageFixture(), source: ControllerSourceInventory = f.source;
	assert.equal(findControllerSource({ sources: [source] }, source.id), null);
	// @ts-expect-error storageKey remains a string in the heterogeneous inventory.
	const invalid: ControllerSourceInventory = { id: 'bad', storageKey: 42 };
	assert.equal(invalid.storageKey, 42);
	const audio = { id: 'audio', kind: 'audio', storageKey: 'audio', name: 'PCM', mimeType: 'audio/wav',
		frameCount: 1, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000 };
	assert.equal(findControllerSource({ sources: [audio, source] }, audio.id), audio);
});

test('an already-published current editable source saves recipe edits by CAS while retaining exact immutable pack authority', async t => {
	const f = editableImageFixture({ sourceId: `saved-image-${crypto.randomUUID()}` });
	const indexedDB = createInstrumentedIndexedDB();
	let store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false }); t.after(async () => { await store.close(); });
	const initial = await openEditableImageFixture(f, store);
	const develop = { ...f.source.develop, geometry: { ...f.source.develop.geometry, crop: { x: 0, y: 0, width: .5, height: 1 } } };
	const source = normalizeFramescaperImageSourceV2({ ...f.source, develop, provenance: { ...f.source.provenance, developSha256: imageDevelopHandoffRecipeSha256V1(develop) } });
	const edited = applyFramescaperProjectCommand(PROFILE, initial, { type: 'image-source/set', sourceId: source.id, expectedSource: f.source, source }, { now: '2026-11-01T00:00:00.000Z' });
	assert.deepEqual(await store.saveProjectIfCurrent(initial, edited), edited);
	assert.equal(await store.saveProjectIfCurrent(initial, edited), null);
	await store.close(); store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	assert.deepEqual(await store.loadProject(initial.id), edited);
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...source, storageKey: `${source.storageKey}-other` }), /storage key.*source id/iu);
	for (const replacement of [
		{ ...source, contentSha256: 'a'.repeat(64) },
		{ ...source, conversionReceiptSha256: 'b'.repeat(64) },
		{ ...source, canonical: { ...source.canonical, hasAlpha: true } },
		{ ...source, assetByteLength: source.assetByteLength + 1 },
		{ ...source, original: { ...source.original, fileName: 'other.png' }, provenance: { ...source.provenance, original: { ...source.provenance.original, exactName: 'other.png' } } },
	]) {
		const admitted = normalizeFramescaperImageSourceV2(replacement);
		const changed = applyFramescaperProjectCommand(PROFILE, edited, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: admitted }, { now: '2026-11-02T00:00:00.000Z' });
		await assert.rejects(store.saveProjectIfCurrent(edited, changed), /immutable image-body authority/u);
	}
	assert.deepEqual(await store.loadProject(initial.id), edited);
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
});

test('real buffered audio mix keeps audio attribution and excludes unrelated image handoff provenance', async () => {
	const f = editableImageFixture(), provenance = createImportedSourceProvenance({ id: 'audio-origin', origin: { kind: 'local-file', originalFileName: 'owned.wav', mimeType: 'audio/wav' } });
	const audio = { id: 'audio', kind: 'audio', storageKey: 'audio', name: 'PCM', mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000, provenance };
	const clip = { id: 'audio-clip', sourceId: 'audio', title: 'PCM', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 1, durationFrames: 1 };
	const project = { schemaVersion: 17, id: 'mixed-inventory', title: 'Mixed', sampleRate: 48_000,
		sources: [audio, f.source], clips: [clip, { ...clip, id: 'image-clip', sourceId: f.source.id }],
		tracks: [{ id: 'audio-track', name: 'Audio', type: 'audio' as const, clipIds: [clip.id], effects: [] }, { id: 'image-track', name: 'Image', type: 'video' as const, clipIds: ['image-clip'] }],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['audio-track'], clipIds: [] }, mixer: { groups: [], sends: [], routes: {} }, trackFolders: [] };
	const pixelsBefore = structuredClone(f.source), channels = [Float32Array.of(.5)], buffer: AudioBufferLike = { length: 1, numberOfChannels: 1, sampleRate: 48_000, getChannelData: index => channels[index]! };
	const attribution: unknown[] = []; let commits = 0, index = 0;
	const dependencies: MixRenderServiceDependencies = {
		lifetime: { assertActive() {}, startTask: () => ({ scope: null, name: 'mix-render', generation: 1, signal: new AbortController().signal, abort() {}, assertCurrent() {}, finish() {} }) },
		copy: { v2Required: 'V2', mixRenderRequiresAudio: 'Audio', audacitySelectionHint: 'Audio', audioTrackRequired: 'Audio', rendering: 'Rendering', mixedTrack: 'Mix', mixRender: 'Mix', mixdownTo: 'Mix', effectInvalidAudio: 'Invalid', done: 'Done' },
		derivedSources: { async persistRenderedMixSource(rendered: AudioBufferLike, name: string, value: unknown) { attribution.push(value); return { source: { ...audio, id: 'rendered', storageKey: 'rendered', name }, buffer: rendered, channels }; }, async rollbackDerivedSources() {},
			uniqueClipSources: () => assert.fail('Unexpected derived clip lookup'), sourceChannelsForEdit: async () => assert.fail('Unexpected channel edit'), persistDerivedSource: async () => assert.fail('Unexpected derived source') },
		store: { beginSourceWrite: async () => assert.fail('Unexpected streaming') }, sourceBuffers: new Map(), sourceChunkFrames: 65_536, memoryLimitBytes: Number.MAX_SAFE_INTEGER,
		getProject: () => project, getSelectedTrackId: () => 'audio-track', getSelectedClipId: () => null, editingBlocked: () => false,
		captureProject: () => ({ generation: 1, projectId: project.id }), assertProject() {}, createId: prefix => `${prefix}-${++index}`,
		commit() { commits++; }, preflightStorage: async () => {}, setProcessing() {}, setStatus() {}, publish() {}, handleError() {}, rackTailFrames: () => 0, isFixedStereoEffect: () => false,
		renderSnapshot: async snapshot => { assert.deepEqual(snapshot.sources.map(source => source.id), ['audio']); return buffer; }, getAudioContext: async () => ({}), createBufferFromChannels: async () => buffer,
		createRenderEngine: () => assert.fail('Unexpected streaming engine'), createStreamingWriter: () => assert.fail('Unexpected writer'), prepareCommittedTimePitchCaches: async () => {}, activateStoredSource: async () => {},
	};
	assert.ok(await createMixRenderService(dependencies).mixAndRenderTracks({ mixDown: false, renderEffects: true, replaceOriginals: false }));
	assert.equal(commits, 1); assert.deepEqual(attribution, [{ ...provenance, classification: 'derived' }]); assert.deepEqual(f.source, pixelsBefore);
});
