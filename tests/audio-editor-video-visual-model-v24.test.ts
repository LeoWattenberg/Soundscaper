/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeVideoAdjustmentLayerV1,
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	VIDEO_VISUAL_MODEL_LIMITS_V1,
} from '../src/common/editor/video-visual-model-v24.ts';

const SHA = 'a'.repeat(64);

test('V24 still sources and clips own explicit bounded raster and duration authority', () => {
	assert.deepEqual(VIDEO_VISUAL_MODEL_LIMITS_V1, {
		maximumDimension: 65_536,
		maximumFrameCount: 2_000_000,
		maximumTextLength: 16_384,
		maximumExternalInputs: 64,
		maximumAdjustmentTargets: 256,
		maximumAdjustmentEffects: 4_096,
	});
	const source = {
		schemaVersion: 1,
		kind: 'still',
		id: 'still-source-1',
		name: 'Plate.png',
		mimeType: 'image/png',
		storageKey: 'media-still-1',
		contentSha256: SHA,
		width: 3_840,
		height: 2_160,
		hasAlpha: true,
	};
	const clip = {
		schemaVersion: 1,
		kind: 'still',
		id: 'still-clip-1',
		sourceId: source.id,
		sequenceId: 'sequence-1',
		sequenceStartFrame: 24,
		sequenceFrameCount: 120,
	};
	const normalizedSource = normalizeVideoStillSourceV1(source);
	const normalizedClip = normalizeVideoStillClipV1(clip);
	assert.deepEqual(normalizedSource, source);
	assert.deepEqual(normalizedClip, clip);
	assert.notStrictEqual(normalizedSource, source);
	assertDeepFrozen(normalizedSource);
	assertDeepFrozen(normalizedClip);
	assert.throws(() => normalizeVideoStillSourceV1({ ...source, kind: 'video' }), /still|kind/iu);
	assert.throws(() => normalizeVideoStillSourceV1({ ...source, width: 65_537 }), /width|65536/iu);
	assert.throws(() => normalizeVideoStillSourceV1({ ...source, mimeType: 'video/png' }), /image|MIME/iu);
	assert.throws(() => normalizeVideoStillClipV1({ ...clip, sequenceFrameCount: 2_000_001 }),
		/frame|2000000/iu);
	assert.throws(() => normalizeVideoStillClipV1({ ...clip, sourceInFrame: 0 }), /unsupported|field/iu);
});

test('V24 generator sources preserve every explicit built-in and external document kind', () => {
	const base = {
		schemaVersion: 1,
		kind: 'generator',
		id: 'generator-source-1',
		name: 'Main title',
		width: 1_920,
		height: 1_080,
		frameRate: { num: 24_000, den: 1_001 },
		frameCount: 240,
	};
	const documents = [{
		kind: 'title',
		text: 'Chapter One',
		fontFamily: 'soundscaper-sans',
		fontSize: 96,
		color: '#ffffffff',
		horizontalAlign: 'center',
		verticalAlign: 'middle',
	}, {
		kind: 'text',
		text: 'Lower third\nSecond line',
		fontFamily: 'soundscaper-mono',
		fontSize: 48,
		color: '#ffeeddff',
		horizontalAlign: 'start',
		verticalAlign: 'end',
	}, {
		kind: 'shape',
		shape: 'ellipse',
		fillColor: '#102030ff',
		strokeColor: '#ffffffff',
		strokeWidth: 2,
	}, {
		kind: 'solid',
		color: '#000000ff',
	}, {
		kind: 'external-generator',
		bindingId: 'ofx-generator-1',
		inputs: [
			{ name: 'Background', sourceRef: 'source-2' },
			{ name: 'Foreground', sourceRef: 'source-1' },
		],
	}] as const;
	for (const generator of documents) {
		const normalized = normalizeVideoGeneratorSourceV1({ ...base, generator });
		assert.equal(normalized.generator.kind, generator.kind);
		assertDeepFrozen(normalized);
	}
	const external = normalizeVideoGeneratorSourceV1({ ...base, generator: documents[4] });
	assert.deepEqual(external.generator, {
		...documents[4],
		inputs: [
			{ name: 'Background', sourceRef: 'source-2' },
			{ name: 'Foreground', sourceRef: 'source-1' },
		],
	});
	assert.throws(() => normalizeVideoGeneratorSourceV1({ ...base, frameRate: { num: 48_000, den: 2_002 }, generator: documents[0] }), /canonical|reduced|rate/iu);
	assert.throws(() => normalizeVideoGeneratorSourceV1({ ...base, generator: {
		...documents[0], fontFamily: 'Arial',
	} }), /font|family/iu);
	assert.throws(() => normalizeVideoGeneratorSourceV1({ ...base, generator: {
		...documents[0], text: 'bad\u0000text',
	} }), /text|control/iu);
	assert.throws(() => normalizeVideoGeneratorSourceV1({ ...base, generator: {
		...documents[4], inputs: [
			{ name: 'Input', sourceRef: 'source-1' },
			{ name: 'Input', sourceRef: 'source-2' },
		],
	} }), /duplicate|input/iu);
});

test('generated clips use explicit source and sequence ranges without inheriting video-only fields', () => {
	const clip = {
		schemaVersion: 1,
		kind: 'generator',
		id: 'generator-clip-1',
		sourceId: 'generator-source-1',
		sequenceId: 'sequence-1',
		sequenceStartFrame: 10,
		sequenceFrameCount: 100,
		sourceInFrame: 5,
		sourceFrameCount: 100,
	};
	assert.deepEqual(normalizeVideoGeneratorClipV1(clip), clip);
	assert.throws(() => normalizeVideoGeneratorClipV1({ ...clip, retimeMap: null }), /unsupported|field/iu);
	assert.throws(() => normalizeVideoGeneratorClipV1({ ...clip, sourceInFrame: -1 }), /source|non-negative/iu);
});

test('adjustment layers are bounded timeline effect hosts with canonical explicit target tracks', () => {
	const layer = {
		schemaVersion: 1,
		kind: 'adjustment-layer',
		id: 'adjustment-1',
		sequenceId: 'sequence-1',
		sequenceStartFrame: 24,
		sequenceFrameCount: 240,
		targetTrackIds: ['track-b', 'track-a'],
		effectIds: ['effect-b', 'effect-a'],
	};
	const normalized = normalizeVideoAdjustmentLayerV1(layer);
	assert.deepEqual(normalized.targetTrackIds, ['track-a', 'track-b']);
	assert.deepEqual(normalized.effectIds, ['effect-a', 'effect-b']);
	assertDeepFrozen(normalized);
	assert.throws(() => normalizeVideoAdjustmentLayerV1({ ...layer, targetTrackIds: [] }), /target|1 through/iu);
	assert.throws(() => normalizeVideoAdjustmentLayerV1({
		...layer, targetTrackIds: ['track-a', 'track-a'],
	}), /duplicate|target/iu);
	assert.throws(() => normalizeVideoAdjustmentLayerV1({
		...layer, effectIds: ['effect-a', 'effect-a'],
	}), /duplicate|effect/iu);
});

function assertDeepFrozen(value: unknown): void {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true);
	for (const child of Object.values(value)) assertDeepFrozen(child);
}
