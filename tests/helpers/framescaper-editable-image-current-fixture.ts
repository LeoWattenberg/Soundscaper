/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceV2 } from '../../src/common/editor/timeline-image-model-v2.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { parseCubeLutV1 } from '../../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject, cloneFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { applyFramescaperProjectCommand } from '../../src/framescaper/editor-project-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../../src/framescaper/editor-project-assistance-foundation.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';

export { PROFILE };
export const CORNERS = Object.freeze([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
export const LUT_BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const parsed = parseCubeLutV1(new TextDecoder().decode(LUT_BODY));
export const LUT = Object.freeze({ storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
	byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax });

/** Model-original custody fixture; no native image ingestion or codec claim. */
export function editableImageFixture(options: Readonly<{ cube?: boolean; crop?: boolean; processVersion?: 1 | 2; sourceId?: string; develop?: ReturnType<typeof defaultImageDevelopStateV2> }> = {}) {
	const crop = options.crop !== false, processVersion = options.processVersion ?? 2;
	const projectId = crypto.randomUUID();
	const original = new TextEncoder().encode('exact orientation-canonical immutable photo original');
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 8, decoder: { id: 'browser-native', version: '1' } },
		width: 2, height: 2, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: Uint8Array.from(CORNERS) }] });
	const develop = options.develop ?? { ...defaultImageDevelopStateV2(), processVersion,
		geometry: { crop: { x: crop ? .5 : 0, y: 0, width: crop ? .5 : 1, height: 1 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false },
		effects: options.cube === undefined ? [] : [{ id: 'saved-profile', type: 'cube-lut-profile-v1', enabled: options.cube, params: { lut: LUT } }] };
	const provenance = createImageDevelopHandoffProvenanceV1({ original: { exactName: 'e\u0301.png', sha256: pack.originalSha256, byteLength: original.byteLength }, develop,
		origin: { schemaFamily: 'lightscaper', schemaVersion: processVersion, catalogId: 'catalog', photoId: 'photo', revision: 7,
			versionId: 'saved', versionKind: 'master', versionName: 'Saved', versionCreatedAt: '2026-10-01T00:00:00.000Z' } });
	const source = normalizeFramescaperImageSourceV2({ schemaVersion: 2, kind: 'image', id: options.sourceId ?? 'image-source', name: 'Saved photo',
		storageKey: options.sourceId ?? 'image-source', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, assetByteLength: pack.assetByteLength,
		contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 2, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' },
		develop, developed: { width: crop ? 1 : 2, height: 2 }, provenance });
	const clip = Object.freeze({ schemaVersion: 1 as const, kind: 'image' as const, id: 'image-clip', sourceId: source.id,
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceStartTicks: '0' });
	function baseProject() {
		const raw = framescaperV20Options();
		return createFramescaperProject(PROFILE, { ...raw, id: projectId, sources: [], clips: [], projectBin: { clips: [] },
			tracks: [createVideoTrack({ id: 'video-track', name: 'Video', clipIds: [], locked: false })],
			sequences: [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }], primarySequenceId: 'main-sequence',
			finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
				alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
	}
	function project(bin = false) {
		return applyFramescaperProjectCommand(PROFILE, baseProject(), { type: 'batch', commands: [
			{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip,
				placement: bin ? { scope: 'project-bin' } : { scope: 'timeline', trackId: 'video-track' } },
		] });
	}
	const calls: string[] = [];
	const store = { async loadMediaAsset(key: string) {
		assert.equal(this, store); calls.push(key);
		if (key === source.storageKey) return new Blob([new Uint8Array(pack.bytes)]);
		assert.equal(key, LUT.storageKey); return new Blob([LUT_BODY]);
	} };
	return { original, pack, source, clip, baseProject, project, imageProject: (bin = false) => framescaperProjectTimelineImageFoundationShapeAssistance(project(bin)), calls, store };
}

/** File/Open's real current archive transaction owns V2 publication; the V1
 * native-image publisher intentionally retains its immutable V1 admission. */
export async function openEditableImageFixture(f: ReturnType<typeof editableImageFixture>, recipient: AudioEditorProjectStore) {
	const sender = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false, databaseName: `image-open-${crypto.randomUUID()}` });
	try {
		await sender.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
		if (f.source.develop.effects.length) await sender.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
		const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(f.project(), sender); assert.ok(exported.blob);
		const imported = await runtime.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
		return cloneFramescaperProject(PROFILE, imported.project);
	} finally { await sender.close(); }
}
