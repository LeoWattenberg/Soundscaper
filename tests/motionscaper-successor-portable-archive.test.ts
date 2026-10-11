/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from '../src/common/editor/video-timing-asset-reference.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { normalizeFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { withScapeArchiveReader } from '../src/common/editor/scape-archive-reader.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { exportFramescaperSuccessorPortableArchive, type FramescaperSuccessorPortableExportStore } from '../src/framescaper/editor-project-successor-portable-export.ts';
import { inspectFramescaperSuccessorPortableArchive } from '../src/framescaper/editor-project-successor-portable-inspect.ts';
import { MOTION_LINKED_ARCHIVE_ASSET_KIND } from '../src/framescaper/editor-project-successor-link-assets.ts';
import { createFramescaperScapeProjectAssetExtension } from '../src/framescaper/editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

const bytes = new Uint8Array([7, 8, 9]); const sha256 = digestScapeBytes(bytes);
function fixture() {
	const snapshot = createMotionscaperRevision({ ...createMotionscaperProject({ id: 'motion', title: 'Linked scene', compositionId: 'main', width: 2, height: 1, durationFrames: 3 }), assets: [
		{ kind: 'image', id: 'unused-image', name: 'Unused original', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}` },
	] });
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', audioSourceId: 'linked-audio', offer: createMotionCompositionOffer('main', snapshot), sampleRate: 48000 });
	const image = createFramescaperBaselineImageFixture();
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const base = runtime.createProject({ title: 'Edited fresh successor', sources: [linked.source, linked.audioSource!] });
	const withImage = runtime.applyCommand(base, { type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source });
	const project = normalizeFramescaperSuccessorProject({ ...withImage, compositionLinks: [linked.link] });
	const reads: string[] = [];
	const store: FramescaperSuccessorPortableExportStore = {
		getMediaAssetMetadata: async (id: string) => id === image.source.storageKey ? { sourceId: id, size: image.bytes.length, sha256: image.source.contentSha256 } : null,
		loadMediaAsset: async (id: string) => { reads.push(id); if (id !== image.source.storageKey) throw new Error('Virtual body lookup is forbidden'); return new Blob([image.bytes.slice()]); },
		async *readSourceChunks() { yield []; throw new Error('Virtual PCM lookup is forbidden'); },
	};
	return { project, sources: project.sources as readonly Readonly<Record<string, unknown>>[], linked, image, reads, store, options: { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) } };
}

test('M10 fresh edited successor export owns schema2, unused ordinary and linked originals, and regenerated exact timing without virtual bodies', async () => {
	const { project, linked, image, reads, store, options } = fixture(); const result = await exportFramescaperSuccessorPortableArchive(project, store, options); assert.ok(result.blob);
	assert.deepEqual(reads, [image.source.storageKey]); const inspected = await inspectFramescaperSuccessorPortableArchive(result.blob);
	assert.deepEqual(inspected.project, project); assert.equal(inspected.readOnly, false); assert.equal(inspected.manifest.project.schemaVersion, 2);
	assert.deepEqual(inspected.manifest.assets.map(({ kind }) => kind).sort(), ['framescaper-image-asset', 'motion-linked-original', 'video-timing']);
	assert.equal(inspected.manifest.assets.find(({ kind }) => kind === 'video-timing')?.sha256, linked.timing.reference.sha256);
	assert.equal(inspected.manifest.assets.some(({ sourceId }) => sourceId === linked.source.id || sourceId === linked.audioSource!.id), false);
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	await withScapeArchiveReader(result.blob, undefined, async entries => { const envelope = await readScapeArchiveEnvelope(entries, {}, undefined, [...extension.assetKinds, MOTION_LINKED_ARCHIVE_ASSET_KIND]); assert.deepEqual(JSON.parse(envelope.projectText), project); });
});

test('M10 successor portable output supports admitted streaming and refuses corrupt retained bodies', async () => {
	const { project, store, options } = fixture(); const output: Uint8Array[] = [];
	const result = await exportFramescaperSuccessorPortableArchive(project, store, { ...options, writable: new WritableStream({ write(chunk) { output.push(chunk.slice()); } }), maximumBlobBytes: 1 });
	assert.equal(result.blob, null); const blob = new Blob(output as Uint8Array<ArrayBuffer>[]); assert.equal(blob.size, result.byteLength); assert.deepEqual((await inspectFramescaperSuccessorPortableArchive(blob)).project, project);
	await assert.rejects(exportFramescaperSuccessorPortableArchive(project, store, { readAsset: async () => ({ size: 3, stream: () => new Blob([new Uint8Array([1, 2, 3])]).stream() }) }), /digest/u);
	await assert.rejects(exportFramescaperSuccessorPortableArchive(project, store, { ...options, maximumBlobBytes: 1 }), /Blob|limit|admission/u);
});

test('M10 successor portable admission refuses forged virtual descriptors before any media acquisition', async () => {
	const { project, sources, linked, store, options, reads } = fixture();
	const changed = { ...project, sources: sources.map(source => source.id === linked.source.id ? { ...source, width: 3 } : source) };
	await assert.rejects(exportFramescaperSuccessorPortableArchive(changed, store, options), /descriptor|contract/u); assert.deepEqual(reads, []);
	await assert.rejects(exportFramescaperSuccessorPortableArchive({ ...project, compositionLinks: [] }, store, options), /typed link/u); assert.deepEqual(reads, []);
});


test('M10 successor portable export cancels a stalled retained-original provider without exposing a completed archive', async () => {
	const { project, store } = fixture(); const abort = new AbortController(); let ready!: () => void;
	const started = new Promise<void>(resolve => { ready = resolve; });
	const pending = exportFramescaperSuccessorPortableArchive(project, store, { signal: abort.signal, readAsset: () => { ready(); return new Promise(() => {}); } });
	const rejected = assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError'); await started; abort.abort(); await rejected;
});


test('M10 successor validation admits total generated timing work before constructing any linked table', async () => {
	const { store, reads, options, linked } = fixture();
	const large = createMotionscaperRevision(createMotionscaperProject({ id: 'large', title: 'Too much timing', compositionId: 'main', durationFrames: VIDEO_TIMING_ASSET_MAXIMUM_FRAMES / 2 + 1 }));
	const base = createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source, linked.audioSource!, { ...linked.source, id: 'linked-second' }] });
	const candidate = { ...base, compositionLinks: [
		createFramescaperCompositionLink(linked.source.id, 'main', large, { audioSourceId: linked.audioSource!.id }), createFramescaperCompositionLink('linked-second', 'main', large),
	] };
	assert.throws(() => normalizeFramescaperSuccessorProject(candidate), /aggregate generated timing-frame budget/u);
	await assert.rejects(exportFramescaperSuccessorPortableArchive(candidate, store, options), /aggregate generated timing-frame budget/u); assert.deepEqual(reads, []);
});
