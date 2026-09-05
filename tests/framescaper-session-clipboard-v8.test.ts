/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import type { FramescaperProjectVisual } from '../src/framescaper/editor-project-visual.ts';
import {
	createFramescaperVisualClipboardV8,
	normalizeFramescaperVisualClipboardV8,
	prepareFramescaperVisualClipboardPasteV8,
} from '../src/framescaper/editor-session-clipboard-v8.ts';
import { visualProject } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;
type PasteOptions = Parameters<typeof prepareFramescaperVisualClipboardPasteV8>[1];

const FALLBACK = createVideoFreezeFallbackV1({
	renderedSourceId: 'still-source',
	renderedAssetSha256: 'aa'.repeat(32),
	authoredStateSha256: 'bb'.repeat(32),
	inputIdentitiesSha256: 'cc'.repeat(32),
	renderPlanFingerprintSha256: 'dd'.repeat(32),
	nativeEffectFingerprintSha256: 'ee'.repeat(32),
});
const EXTERNAL_GENERATOR = Object.freeze({
	kind: 'external-generator',
	bindingId: 'title-binding',
	inputs: [{ name: 'plate', sourceRef: 'video-source' }],
});

function project(): FramescaperProjectVisual {
	return visualProject(FALLBACK);
}

function board(): Data {
	return createFramescaperVisualClipboardV8(PROFILE, project()) as unknown as Data;
}

function wire(value: Data): Data {
	return JSON.parse(JSON.stringify(value)) as Data;
}

/** The same fragment with its generator swapped for one that references a foreign source. */
function externalBoard(): Data {
	const detached = wire(board());
	const sources = detached.sources as Data[];
	sources[1] = { ...sources[1]!, generator: { ...EXTERNAL_GENERATOR } };
	return detached;
}

function maps(overrides: Partial<Record<keyof PasteOptions, unknown>> = {}): PasteOptions {
	return {
		sourceIdMap: new Map([
			['still-source', 'fresh-still-source'],
			['generator-source', 'fresh-generator-source'],
		]),
		clipIdMap: new Map([
			['still-clip', 'fresh-still-clip'],
			['generator-clip', 'fresh-generator-clip'],
		]),
		adjustmentLayerIdMap: new Map([['adjustment', 'fresh-adjustment']]),
		presetIdMap: new Map([['preset', 'fresh-preset']]),
		maskMatteIdMap: new Map([['mask', 'fresh-mask']]),
		projectReferenceIdMap: new Map([
			['main-sequence', 'target-sequence'],
			['video-track', 'target-track'],
		]),
		...overrides,
	} as unknown as PasteOptions;
}

function emptyMaps(): PasteOptions {
	return {
		sourceIdMap: new Map(), clipIdMap: new Map(), adjustmentLayerIdMap: new Map(),
		presetIdMap: new Map(), maskMatteIdMap: new Map(), projectReferenceIdMap: new Map(),
	} as unknown as PasteOptions;
}

function ids(values: readonly unknown[]): unknown[] {
	return values.map((value) => (value as Data).id);
}

test('a v8 clipboard carries only the still and generator state a visual project owns', () => {
	const source = project();

	const fragment = board();

	assert.equal(fragment.schemaVersion, 8);
	assert.equal(fragment.kind, 'framescaper-visual-fragment');
	assert.equal(fragment.originProjectId, source.id);
	assert.equal(fragment.originRevision, source.revision);
	assert.deepEqual(ids(fragment.sources as unknown[]), ['still-source', 'generator-source']);
	assert.deepEqual(ids(fragment.clips as unknown[]), ['still-clip', 'generator-clip']);
	assert.deepEqual(ids(fragment.adjustmentLayers as unknown[]), ['adjustment']);
	assert.deepEqual(ids(fragment.presets as unknown[]), ['preset']);
	assert.deepEqual(ids(fragment.maskMattes as unknown[]), ['mask']);
	assert.deepEqual(
		(fragment.freezeFallbacks as Data[]).map(({ renderedSourceId }) => renderedSourceId),
		['still-source'],
	);
	assert.ok(Object.isFrozen(fragment));
	assert.ok(Object.isFrozen(fragment.sources));
});

test('a v8 clipboard leaves the ordinary audio and video state of the project behind', () => {
	const fragment = board();

	const carried = new Set([
		...ids(fragment.sources as unknown[]),
		...ids(fragment.clips as unknown[]),
	].map(String));
	assert.equal(carried.has('video-source'), false);
	assert.equal(carried.has('audio-source'), false);
	assert.equal(carried.has('video-clip'), false);
	assert.equal(carried.has('audio-clip'), false);
});

test('creating a v8 clipboard demands the authenticated profile and a valid visual project', () => {
	const misdirected = structuredClone(project()) as unknown as Data;
	(misdirected.videoAdjustmentLayers as Data[])[0]!.targetTrackIds = ['audio-track'];

	assert.throws(
		() => createFramescaperVisualClipboardV8({ id: 'framescaper' }, project()),
		/authenticated Framescaper 1\.0 runtime profile is required/u,
	);
	assert.throws(
		() => createFramescaperVisualClipboardV8(PROFILE, misdirected),
		/Adjustment target audio-track is not a video track/u,
	);
});

test('a v8 clipboard survives a JSON round trip unchanged', () => {
	const fragment = board();

	const restored = normalizeFramescaperVisualClipboardV8(wire(fragment));

	assert.deepEqual(restored, fragment);
	assert.ok(Object.isFrozen(restored.clips));
});

test('a v8 clipboard from another schema generation or kind demands a re-copy', () => {
	const fragment = wire(board());

	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, schemaVersion: 7 }),
		/requires V8 recopy/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, kind: 'framescaper-visual-clipboard' }),
		/clipboard kind is invalid/u,
	);
});

test('a v8 clipboard refuses values that are not exact plain records of its schema keys', () => {
	const fragment = wire(board());
	const withoutPresets = { ...fragment };
	delete withoutPresets.presets;
	const accessor = { ...fragment };
	Object.defineProperty(accessor, 'originProjectId', { get: () => 'framescaper-v20', enumerable: true });

	assert.throws(() => normalizeFramescaperVisualClipboardV8(null), /must be a plain object/u);
	assert.throws(() => normalizeFramescaperVisualClipboardV8([fragment]), /must be a plain object/u);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, transitions: [] }),
		/contains an unsupported field/u,
	);
	assert.throws(() => normalizeFramescaperVisualClipboardV8(withoutPresets), /presets is required/u);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8(accessor),
		/originProjectId must be an enumerable own data property/u,
	);
});

test('a v8 clipboard refuses an origin identity or revision outside its stated domain', () => {
	const fragment = wire(board());
	const refuse = (overrides: Data, message: RegExp): void => {
		assert.throws(() => normalizeFramescaperVisualClipboardV8({ ...fragment, ...overrides }), message);
	};

	refuse({ originProjectId: '' }, /originProjectId is invalid/u);
	refuse({ originProjectId: 'x'.repeat(129) }, /originProjectId is invalid/u);
	refuse({ originProjectId: 42 }, /originProjectId is invalid/u);
	refuse({ originRevision: -1 }, /originRevision is invalid/u);
	refuse({ originRevision: 1.5 }, /originRevision is invalid/u);
	refuse({ originRevision: '3' }, /originRevision is invalid/u);
});

test('a v8 clipboard refuses collections that are not bounded arrays', () => {
	const fragment = wire(board());

	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, sources: {} }),
		/V8 clipboard sources must be an array/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, clips: new Array(100_001) as unknown[] }),
		/V8 clipboard clips requires 0 through 100000 entries/u,
	);
});

test('a v8 clipboard refuses source and clip entries outside the still and generator kinds', () => {
	const fragment = wire(board());
	const still = (fragment.sources as Data[])[0]!;
	const accessorKind = { ...still };
	Object.defineProperty(accessorKind, 'kind', { get: () => 'still', enumerable: true });

	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, sources: [{ ...still, kind: 'video' }] }),
		/V8 visual clipboard source kind is unsupported/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({
			...fragment,
			clips: [{ ...(fragment.clips as Data[])[0]!, kind: 'audio' }],
		}),
		/V8 visual clipboard clip kind is unsupported/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, sources: ['still-source'] }),
		/V8 clipboard item must be an object/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({ ...fragment, sources: [accessorKind] }),
		/V8 clipboard kind must be data/u,
	);
});

test('a v8 clipboard revalidates every model it carries rather than trusting the wire', () => {
	const fragment = wire(board());
	const mask = (fragment.maskMattes as Data[])[0]!;

	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({
			...fragment,
			presets: [{ ...(fragment.presets as Data[])[0]!, modelKind: 'transition' }],
		}),
		/preset modelKind is unsupported/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({
			...fragment,
			maskMattes: [{ ...mask, outputNodeId: 'absent' }],
		}),
		/output references missing node absent/u,
	);
	assert.throws(
		() => normalizeFramescaperVisualClipboardV8({
			...fragment,
			freezeFallbacks: [{ ...(fragment.freezeFallbacks as Data[])[0]!, freshnessSha256: '11'.repeat(32) }],
		}),
		/freshness digest does not match its bound components/u,
	);
});

test('a v8 paste rewrites every owned identity and repoints every reference it carries', () => {
	const fragment = board();

	const pasted = prepareFramescaperVisualClipboardPasteV8(fragment, maps());

	assert.deepEqual(ids(pasted.sources), ['fresh-still-source', 'fresh-generator-source']);
	assert.deepEqual(pasted.clips[0], {
		schemaVersion: 1, kind: 'still', id: 'fresh-still-clip', sourceId: 'fresh-still-source',
		sequenceId: 'target-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
	});
	assert.deepEqual(pasted.clips[1], {
		schemaVersion: 1, kind: 'generator', id: 'fresh-generator-clip', sourceId: 'fresh-generator-source',
		sequenceId: 'target-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	assert.deepEqual(pasted.adjustmentLayers[0], {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'fresh-adjustment', sequenceId: 'target-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 30, targetTrackIds: ['target-track'], effectIds: [],
	});
	assert.equal(pasted.presets[0]?.id, 'fresh-preset');
	assert.equal(pasted.maskMattes[0]?.id, 'fresh-mask');
	assert.equal(pasted.maskMattes[0]?.inputs[0]?.sourceRef, 'fresh-still-source');
	assert.equal(pasted.freezeFallbacks[0]?.renderedSourceId, 'fresh-still-source');
	assert.equal(
		pasted.freezeFallbacks[0]?.freshnessSha256,
		(fragment.freezeFallbacks as Data[])[0]!.freshnessSha256,
	);
	assert.ok(Object.isFrozen(pasted) && Object.isFrozen(pasted.sources) && Object.isFrozen(pasted.clips));
});

test('a v8 paste leaves the stored body identity of a still source alone', () => {
	const pasted = prepareFramescaperVisualClipboardPasteV8(board(), maps());

	assert.deepEqual(pasted.sources[0], {
		schemaVersion: 1, kind: 'still', id: 'fresh-still-source', name: 'Plate', mimeType: 'image/png',
		storageKey: 'still-storage', contentSha256: 'aa'.repeat(32), width: 1_920, height: 1_080, hasAlpha: true,
	});
});

test('a v8 paste sends an external generator input through the destination reference map', () => {
	const pasted = prepareFramescaperVisualClipboardPasteV8(externalBoard(), maps({
		projectReferenceIdMap: new Map([
			['main-sequence', 'target-sequence'],
			['video-track', 'target-track'],
			['video-source', 'target-video-source'],
		]),
	}));

	const generator = (pasted.sources[1] as unknown as Data).generator as Data;
	assert.equal(generator.kind, 'external-generator');
	assert.deepEqual(generator.inputs, [{ name: 'plate', sourceRef: 'target-video-source' }]);
});

test('an empty v8 fragment pastes to empty collections without demanding any allocation', () => {
	const empty = {
		schemaVersion: 8, kind: 'framescaper-visual-fragment', originProjectId: 'framescaper-v20',
		originRevision: 4, sources: [], clips: [], adjustmentLayers: [], presets: [],
		maskMattes: [], freezeFallbacks: [],
	};

	const pasted = prepareFramescaperVisualClipboardPasteV8(empty, emptyMaps());

	assert.deepEqual(pasted, {
		sources: [], clips: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
	});
});

test('a v8 paste refuses identity maps that are absent, foreign or unbounded', () => {
	const fragment = board();
	const oversized = {
		size: 100_001, get: () => undefined, has: () => false, entries: () => [][Symbol.iterator](),
	};

	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(fragment, undefined as never),
		/V8 paste sourceIdMap must be a bounded map/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(fragment, maps({ presetIdMap: { preset: 'fresh-preset' } })),
		/V8 paste presetIdMap must be a bounded map/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(fragment, maps({ maskMatteIdMap: oversized })),
		/V8 paste maskMatteIdMap must be a bounded map/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(fragment, maps({
			projectReferenceIdMap: { ...oversized, size: Number.NaN },
		})),
		/V8 paste projectReferenceIdMap must be a bounded map/u,
	);
});

test('a v8 paste refuses a fresh allocation that reuses an identity the fragment already names', () => {
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			sourceIdMap: new Map([
				['still-source', 'main-sequence'],
				['generator-source', 'fresh-generator-source'],
			]),
		})),
		/A V8 paste source allocation must be fresh/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			adjustmentLayerIdMap: new Map([['adjustment', 'still-clip']]),
		})),
		/A V8 paste adjustment layer allocation must be fresh/u,
	);
});

test('a v8 paste refuses two owned models allocated to the same fresh identity', () => {
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			clipIdMap: new Map([
				['still-clip', 'fresh-still-source'],
				['generator-clip', 'fresh-generator-clip'],
			]),
		})),
		/V8 paste top-level allocations must be unique/u,
	);
});

test('a v8 paste names the role of the mapping it could not resolve', () => {
	const missing = (overrides: Partial<Record<keyof PasteOptions, unknown>>, message: RegExp): void => {
		assert.throws(
			() => prepareFramescaperVisualClipboardPasteV8(board(), maps(overrides)),
			(error: unknown) => {
				assert.ok(error instanceof ReferenceError);
				assert.match(error.message, message);
				return true;
			},
		);
	};

	missing(
		{ projectReferenceIdMap: new Map([['video-track', 'target-track']]) },
		/no mapping for clip sequence main-sequence/u,
	);
	missing(
		{ projectReferenceIdMap: new Map([['main-sequence', 'target-sequence']]) },
		/no mapping for adjustment-layer track video-track/u,
	);
	missing({ maskMatteIdMap: new Map() }, /no mapping for mask\/matte mask/u);
	missing({ presetIdMap: new Map() }, /no mapping for preset preset/u);
});

test('a v8 paste refuses a mapped identity that is not a stable ID', () => {
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			sourceIdMap: new Map([
				['still-source', 'not a stable id'],
				['generator-source', 'fresh-generator-source'],
			]),
		})),
		/mapped source must be a stable ID/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			projectReferenceIdMap: new Map([
				['main-sequence', 'x'.repeat(129)],
				['video-track', 'target-track'],
			]),
		})),
		/mapped clip sequence must be a stable ID/u,
	);
});

test('a v8 paste refuses a destination reference that collides with a fresh identity', () => {
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			projectReferenceIdMap: new Map([
				['main-sequence', 'fresh-still-source'],
				['video-track', 'target-track'],
			]),
		})),
		/A V8 paste reference cannot collide with a fresh identity/u,
	);
});

test('a v8 paste refuses allocations the fragment never consumes', () => {
	const refuse = (overrides: Partial<Record<keyof PasteOptions, unknown>>, message: RegExp): void => {
		assert.throws(() => prepareFramescaperVisualClipboardPasteV8(board(), maps(overrides)), message);
	};

	refuse(
		{
			sourceIdMap: new Map([
				['still-source', 'fresh-still-source'],
				['generator-source', 'fresh-generator-source'],
				['ghost-source', 'fresh-ghost-source'],
			]),
		},
		/V8 source paste contains an unused allocation ghost-source/u,
	);
	refuse(
		{ presetIdMap: new Map([['preset', 'fresh-preset'], ['ghost', 'fresh-ghost']]) },
		/V8 preset paste contains an unused allocation ghost/u,
	);
	refuse(
		{
			projectReferenceIdMap: new Map([
				['main-sequence', 'target-sequence'],
				['video-track', 'target-track'],
				['still-source', 'target-still-source'],
			]),
		},
		/V8 project reference paste contains an unused allocation still-source/u,
	);
});

test('a v8 paste refuses allocation entries whose own keys or targets are not stable IDs', () => {
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			projectReferenceIdMap: new Map([
				['main-sequence', 'target-sequence'],
				['video-track', 'target-track'],
				['', 'target-nothing'],
			]),
		})),
		/project reference allocation source must be a stable ID/u,
	);
	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8(board(), maps({
			maskMatteIdMap: new Map([['mask', 'fresh-mask'], ['ghost', 'not a stable id']]),
		})),
		/mask\/matte allocation target must be a stable ID/u,
	);
});

test('a v8 paste normalizes the fragment it is handed before allocating anything', () => {
	const fragment = wire(board());

	assert.throws(
		() => prepareFramescaperVisualClipboardPasteV8({ ...fragment, schemaVersion: 11 }, maps()),
		/requires V8 recopy/u,
	);
});
