/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	createFramescaperProjectV25,
} from '../src/framescaper/editor-project-v25.ts';
import {
	FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import {
	prepareFramescaperVisualClipboardPasteV8,
} from '../src/framescaper/editor-session-clipboard-v8.ts';
import {
	createFramescaperProfessionalMediaClipboardV9,
	prepareFramescaperProfessionalMediaClipboardPasteV9,
} from '../src/framescaper/editor-session-clipboard-v9.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('V8 paste consumes exact fresh allocations and rewrites every project-owned reference', () => {
	const clipboard = visualClipboard();
	const paste = prepareFramescaperVisualClipboardPasteV8(clipboard, {
		sourceIdMap: new Map([['still-source', 'still-copy'], ['generator-source', 'generator-copy']]),
		clipIdMap: new Map([['still-clip', 'still-clip-copy']]),
		adjustmentLayerIdMap: new Map([['adjustment-1', 'adjustment-copy']]),
		presetIdMap: new Map([['preset-1', 'preset-copy']]),
		maskMatteIdMap: new Map([['mask-1', 'mask-copy']]),
		projectReferenceIdMap: new Map([
			['main-sequence', 'destination-sequence'],
			['video-track', 'destination-track'],
			['effect-1', 'destination-effect'],
			['rendered-source', 'rendered-source-copy'],
		]),
	});

	assert.deepEqual(paste.sources.map(({ id }) => id), ['still-copy', 'generator-copy']);
	assert.deepEqual(paste.clips.map(({ id, sourceId, sequenceId }) => ({ id, sourceId, sequenceId })), [{
		id: 'still-clip-copy', sourceId: 'still-copy', sequenceId: 'destination-sequence',
	}]);
	assert.deepEqual(paste.adjustmentLayers[0], {
		...clipboard.adjustmentLayers[0],
		id: 'adjustment-copy', sequenceId: 'destination-sequence',
		targetTrackIds: ['destination-track'], effectIds: ['destination-effect'],
	});
	assert.equal(paste.maskMattes[0]?.id, 'mask-copy');
	assert.equal(paste.maskMattes[0]?.inputs[0]?.sourceRef, 'still-copy');
	assert.equal(paste.freezeFallbacks[0]?.renderedSourceId, 'rendered-source-copy');
	assert.equal(paste.presets[0]?.id, 'preset-copy');
	assert.deepEqual(clipboard, visualClipboard(), 'paste must not mutate clipboard custody');
});

test('V8 paste rejects missing, duplicate, or unused allocation authority', () => {
	const complete = visualPasteOptions();
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(visualClipboard(), {
			...complete, clipIdMap: new Map(),
		}),
		/mapping.*still-clip|clip.*allocation/iu,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(visualClipboard(), {
			...complete,
			sourceIdMap: new Map([['still-source', 'same-id'], ['generator-source', 'same-id']]),
		}),
		/unique|duplicate/iu,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(visualClipboard(), {
			...complete,
			presetIdMap: new Map([['preset-1', 'preset-copy'], ['unused', 'unused-copy']]),
		}),
		/unused.*allocation/iu,
	);
});

test('V9 paste remaps source and compact image-sequence identity while preserving media authority', () => {
	const project = createFramescaperProjectV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		professionalOptions(),
	);
	const clipboard = createFramescaperProfessionalMediaClipboardV9(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		project,
		['video-source'],
	);
	const pasted = prepareFramescaperProfessionalMediaClipboardPasteV9(clipboard, {
		sourceIdMap: new Map([['video-source', 'video-source-copy']]),
	});

	assert.equal(pasted[0]?.id, 'video-source-copy');
	assert.equal(pasted[0]?.imageSequence?.id, 'video-source-copy');
	assert.equal(pasted[0]?.imageSequence?.inventory.sha256, SHA_B);
	assert.equal(pasted[0]?.storageKey, clipboard.sources[0]?.storageKey);
	assert.deepEqual(pasted[0]?.characteristics, clipboard.sources[0]?.characteristics);
	assert.notStrictEqual(pasted[0], clipboard.sources[0]);
	assert.throws(
		() => prepareFramescaperProfessionalMediaClipboardPasteV9(clipboard, {
			sourceIdMap: new Map(),
		}),
		/mapping|allocation/iu,
	);
	assert.throws(
		() => prepareFramescaperProfessionalMediaClipboardPasteV9(clipboard, {
			sourceIdMap: new Map([
				['video-source', 'video-source-copy'], ['unused', 'unused-copy'],
			]),
		}),
		/unused.*allocation/iu,
	);
});

function visualClipboard() {
	return {
		schemaVersion: 8 as const,
		kind: 'framescaper-visual-fragment' as const,
		originProjectId: 'origin', originRevision: 1,
		sources: [stillSource(), generatorSource()],
		clips: [stillClip()],
		adjustmentLayers: [{
			schemaVersion: 1 as const, kind: 'adjustment-layer' as const, id: 'adjustment-1',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			targetTrackIds: ['video-track'], effectIds: ['effect-1'],
		}],
		presets: [{
			schemaVersion: 1 as const, kind: 'video-preset' as const, id: 'preset-1', name: 'Look',
			modelKind: 'adjustment-layer' as const, authoredStateSha256: SHA_A,
		}],
		maskMattes: [{
			schemaVersion: 1 as const, id: 'mask-1', kind: 'mask' as const,
			inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' as const }],
			nodes: [{ id: 'shape-1', kind: 'vector-shape' as const, shape: 'rectangle' as const,
				x: 0, y: 0, width: 100, height: 100 }],
			outputNodeId: 'shape-1',
		}],
		freezeFallbacks: [createVideoFreezeFallbackV1({
			renderedSourceId: 'rendered-source', renderedAssetSha256: SHA_A,
			authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
			renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D,
		})],
	};
}

function visualPasteOptions() {
	return {
		sourceIdMap: new Map([['still-source', 'still-copy'], ['generator-source', 'generator-copy']]),
		clipIdMap: new Map([['still-clip', 'still-clip-copy']]),
		adjustmentLayerIdMap: new Map([['adjustment-1', 'adjustment-copy']]),
		presetIdMap: new Map([['preset-1', 'preset-copy']]),
		maskMatteIdMap: new Map([['mask-1', 'mask-copy']]),
		projectReferenceIdMap: new Map([
			['main-sequence', 'destination-sequence'], ['video-track', 'destination-track'],
			['effect-1', 'destination-effect'], ['rendered-source', 'rendered-source-copy'],
		]),
	};
}

function stillSource() {
	return {
		schemaVersion: 1 as const, kind: 'still' as const, id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: SHA_A,
		width: 100, height: 100, hasAlpha: true,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1 as const, kind: 'generator' as const, id: 'generator-source', name: 'Title',
		width: 100, height: 100, frameRate: { num: 25, den: 1 }, frameCount: 100,
		generator: { kind: 'solid' as const, color: '#ffffffff' },
	};
}

function stillClip() {
	return {
		schemaVersion: 1 as const, kind: 'still' as const, id: 'still-clip',
		sourceId: 'still-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 10,
	};
}

function professionalOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.storageKey = `image-sequence-pack-sha256:${SHA_A}`;
	source.contentSha256 = SHA_A;
	source.characteristics = professionalCharacteristics();
	source.imageSequence = imageSequence();
	return { ...options, videoTransitionsByTrackId: { 'video-track': [] } };
}

function imageSequence() {
	return {
		kind: 'video', sourceType: 'image-sequence', version: 1, id: 'video-source',
		name: 'Video', stem: 'shot_', extension: 'png', frameNumberWidth: 4,
		firstFrameNumber: 1, lastFrameNumber: 10, frameCount: 10,
		frameRate: { num: 10, den: 1 },
		inventory: { kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${SHA_B}`, sha256: SHA_B,
			byteLength: 512, frameCount: 10, firstFrameNumber: 1, lastFrameNumber: 10 },
		sourcePack: { kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${SHA_A}`, sha256: SHA_A, byteLength: 8_192 },
		characteristics: professionalCharacteristics(),
	};
}

function professionalCharacteristics() {
	return {
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: true, bitDepth: 8, pixelFormat: 'rgba', chromaFormat: '4:4:4',
		alphaMode: 'straight', alphaInterpretation: 'transparency',
		colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'full' },
	};
}
