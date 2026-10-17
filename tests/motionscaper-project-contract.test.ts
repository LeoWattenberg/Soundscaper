/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { createMotionscaperRevision, verifyMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { normalizeMotionAsset, verifyMotionAssetBody } from '../src/common/editor/motion-asset.ts';
import { normalizeMotionProperty, motionScalar, motionVector, motionColor } from '../src/common/editor/motion-property.ts';
import type { MotionLayerContent } from '../src/common/editor/motion-composition.ts';

const r = (num: number, den = 1) => ({ num, den });
const empty = () => createMotionscaperProject({ id: 'project-1', title: 'Title sequence', compositionId: 'main' });
const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const media = (kind: 'footage' | 'image' | 'audio' | 'font') => ({
	id: kind, name: kind, kind, sha256: digest, byteLength: 3,
	storageKey: `motion-sha256:${digest}`, mimeType: kind === 'font' ? 'font/ttf' : `${kind === 'footage' ? 'video' : kind}/test`,
	...(kind === 'font' ? { family: 'Test', style: 'Regular' }
		: kind === 'audio' ? { sampleRate: 48_000, channels: 2, duration: r(10) }
			: { width: 1920, height: 1080, hasAlpha: kind === 'image',
				...(kind === 'footage' ? { frameRate: r(24), duration: r(10), hasAudio: true } : {}) }),
});
const path = { closed: true, vertices: [[0, 0], [100, 0], [100, 100]].map((point) => ({ point, inTangent: [0, 0], outTangent: [0, 0] })) };
const contents = (): MotionLayerContent[] => [
	{ kind: 'footage', assetId: 'footage', audioEnabled: true, audioGain: motionScalar(1) },
	{ kind: 'image', assetId: 'image' },
	{ kind: 'text', document: { runs: [{ text: 'Motion', fontAssetId: 'font', fontSize: motionScalar(64), color: motionColor([1, 0, 0, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([800, 200]) } },
	{ kind: 'shapes', shapes: [{ id: 'shape', path: normalizeMotionProperty({ kind: 'path', value: path, keyframes: [], segments: [], expression: null }) as Extract<ReturnType<typeof normalizeMotionProperty>, { kind: 'path' }>, fill: motionColor([0, 1, 0, 1]), stroke: null }] },
	{ kind: 'solid', color: motionColor([0, 0, 1, 1]), size: motionVector([1920, 1080]) },
	{ kind: 'null' },
	{ kind: 'adjustment', targetLayerIds: ['layer-0'] },
	{ kind: 'precomp', compositionId: 'child' },
	{ kind: 'camera', projection: 'perspective', zoom: motionScalar(1000), near: 0.1, far: 10000, focusDistance: motionScalar(1000), aperture: motionScalar(0) },
	{ kind: 'light', lightType: 'spot', color: motionColor([1, 1, 1, 1]), intensity: motionScalar(1), coneAngle: motionScalar(45), coneFeather: motionScalar(0.5), castsShadows: true },
];

test('M02 fresh projects own a distinct frozen family and composition authority', () => {
	const project = empty();
	assert.equal(project.schemaFamily, 'motionscaper');
	assert.equal(project.schemaVersion, 1);
	assert.equal(project.revision, 0);
	assert.equal(project.primaryCompositionId, 'main');
	assert.equal(project.compositions[0]!.width, 1920);
	assert.deepEqual(project.compositions[0]!.frameRate, r(30));
	assert.equal(project.compositions[0]!.durationFrames, 300);
	assert(Object.isFrozen(project.compositions[0]!.layers));
	assert.deepEqual(normalizeMotionscaperProject(JSON.parse(JSON.stringify(project))), project);
});

test('M02 serialization preserves every declared layer and property kind', () => {
	const project = empty();
	const child = { ...project.compositions[0]!, id: 'child', name: 'Nested', frameRate: r(24), layers: [] };
	const layers = contents().map((content, index) => createMotionLayer({
		id: `layer-${index}`, name: content.kind, durationFrames: 300, content,
	}));
	const rich = normalizeMotionscaperProject({ ...project, assets: ['footage', 'image', 'audio', 'font'].map((kind) => media(kind as Parameters<typeof media>[0])),
		compositions: [{ ...project.compositions[0], layers }, child] });
	assert.deepEqual(normalizeMotionscaperProject(JSON.parse(JSON.stringify(rich))), rich);
	assert.deepEqual(rich.compositions[0]!.layers.map((layer) => layer.kind), contents().map((content) => content.kind));
	assert(Object.isFrozen(rich.compositions[0]!.layers[2]!.transform.position));
});

test('M02 refuses missing or wrongly typed assets, layer relationships and composition cycles', () => {
	const project = empty();
	const layer = createMotionLayer({ id: 'layer', name: 'Layer', durationFrames: 300, content: { kind: 'image', assetId: 'image' } });
	const withLayers = (layers: readonly unknown[], assets: readonly unknown[] = []) => ({ ...project, assets, compositions: [{ ...project.compositions[0], layers }] });
	assert.throws(() => normalizeMotionscaperProject(withLayers([layer])), /asset.*image|image.*asset/iu);
	assert.throws(() => normalizeMotionscaperProject(withLayers([layer], [{ ...media('font'), id: 'image' }])), /asset.*kind|image.*asset/iu);
	const first = { ...createMotionLayer({ id: 'a', name: 'A', durationFrames: 300, content: { kind: 'null' } }), parentId: 'b' };
	const second = { ...first, id: 'b', parentId: 'a' };
	assert.throws(() => normalizeMotionscaperProject(withLayers([first, second])), /cycle/iu);
	assert.throws(() => normalizeMotionscaperProject(withLayers([{ ...first, parentId: 'absent' }])), /parent/iu);
	assert.throws(() => normalizeMotionscaperProject(withLayers([{ ...first, parentId: null, matte: { layerId: 'a', mode: 'alpha' } }])), /cycle/iu);
	const recursive = createMotionLayer({ id: 'pre', name: 'Recursive', durationFrames: 300, content: { kind: 'precomp', compositionId: 'main' } });
	assert.throws(() => normalizeMotionscaperProject(withLayers([recursive])), /cycle/iu);
});

test('M02 rejects malformed timing, duplicate identity and executable/platform-local data', () => {
	const project = empty();
	assert.throws(() => normalizeMotionscaperProject({ ...project, schemaFamily: 'framescaper' }), /family/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, schemaVersion: 2 }), /version/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, opaqueExtensions: {} }), /unsupported/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [project.compositions[0], project.compositions[0]] }), /duplicate/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], frameRate: r(0) }] }), /positive/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], durationFrames: 0 }] }), /duration/iu);
	let reads = 0;
	const hostile = { ...project };
	Object.defineProperty(hostile, 'title', { enumerable: true, get() { reads += 1; return 'bad'; } });
	assert.throws(() => normalizeMotionscaperProject(hostile), /data propert|accessor/iu);
	assert.equal(reads, 0);
	assert.throws(() => normalizeMotionAsset({ ...media('image'), path: '/tmp/private.png' }), /unsupported/iu);
});

test('M02 binds media bytes and saved revisions to content rather than names or paths', () => {
	const asset = normalizeMotionAsset(media('image'));
	assert.doesNotThrow(() => verifyMotionAssetBody(asset, new TextEncoder().encode('abc')));
	assert.throws(() => verifyMotionAssetBody(asset, new TextEncoder().encode('abd')), /digest/iu);
	assert.throws(() => normalizeMotionAsset({ ...asset, storageKey: 'elsewhere' }), /storageKey/iu);
	const revision = createMotionscaperRevision(empty());
	assert.equal(revision.projectId, 'project-1');
	assert.equal(revision.revision, 0);
	assert.match(revision.digest, /^[a-f0-9]{64}$/u);
	assert.deepEqual(verifyMotionscaperRevision(JSON.parse(JSON.stringify(revision))), revision);
	assert.throws(() => verifyMotionscaperRevision({ ...revision, project: { ...revision.project, title: 'Altered' } }), /digest/iu);
	assert.notEqual(createMotionscaperRevision({ ...empty(), title: 'Renamed' }).digest, revision.digest);
});

test('M02 property contracts reject channel mismatches and incompatible path morphs', () => {
	assert.throws(() => normalizeMotionProperty({ kind: 'vector3', value: [1, 2], curves: [null, null, null], expression: null }), /entries|vector/iu);
	assert.throws(() => normalizeMotionProperty({ ...motionScalar(0), curve: { anchors: [{ position: r(1), value: 1 }, { position: r(0), value: 0 }], segments: [{ kind: 'linear' }] } }), /increasing/iu);
	assert.throws(() => normalizeMotionProperty({ kind: 'path', value: path,
		keyframes: [{ position: r(0), value: path }, { position: r(20), value: { ...path, vertices: path.vertices.slice(0, 2) } }],
		segments: ['linear'], expression: null }), /topology|vertices/iu);
});
