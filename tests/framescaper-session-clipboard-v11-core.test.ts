/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperFinishingClipboardV11,
	createFramescaperSessionClipboardV11,
	normalizeFramescaperFinishingClipboardV11,
	normalizeFramescaperSessionClipboardV11,
	prepareFramescaperFinishingClipboardPasteV11,
} from '../src/framescaper/editor-session-clipboard-v11.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);
const ORIGIN_ID = 'origin-project';
const ORIGIN_REVISION = 4;

function project(input: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, input as never) as unknown as Data;
}

function plainProject(): Data {
	return project(framescaperV20Options());
}

function descriptor(source: Data): Data {
	const clip = (source.clips as Data[])[0]!;
	return {
		schemaVersion: 2, sampleRate: source.sampleRate, durationFrames: 10,
		tracks: [{
			sourceTrackId: 'video-track', sourceTrackName: 'Video', sourceTrackType: 'video',
			sourceLaneGroupId: null,
			clips: [{
				key: `${String(clip.id)}:0:10`, kind: 'video', sourceId: clip.sourceId,
				offsetFrame: 0, sourceStartFrame: 0, durationFrames: 10,
			}],
		}],
	};
}

/** An origin whose primary grid aliases a second, nested sequence. */
function nestedSequenceProject(): Data {
	const main = structuredClone((project({}).sequences as Data[])[0]!);
	return project({
		sequences: [main, { ...structuredClone(main), id: 'nested-sequence', name: 'Nested' }],
		subsequences: [{
			id: 'nested-alias', sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		}],
	});
}

function multicameraOptions(): Data {
	const input = framescaperV20Options();
	const sources = input.sources as Data[];
	input.sources = [...sources, {
		...sources[0], id: 'alternate-video-source', name: 'Alternate video',
		storageKey: 'alternate-video-source', contentSha256: '34'.repeat(32),
	}];
	input.multicameraGroups = [{
		id: 'camera-group', projectId: 'framescaper-v20', sequenceId: 'main-sequence',
		outputClipId: 'video-clip', activeMemberId: 'camera-a',
		members: [
			{ id: 'camera-a', groupId: 'camera-group', sourceId: 'video-source', syncOffsetSamples: 0 },
			{ id: 'camera-b', groupId: 'camera-group', sourceId: 'alternate-video-source', syncOffsetSamples: 0 },
		],
	}];
	return input;
}

function stillSource(): Data {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate', mimeType: 'image/png',
		storageKey: 'still-storage', contentSha256: SHA_A, width: 1_920, height: 1_080, hasAlpha: true,
	};
}

function presentation(id: string, owner: Data, extra: Data = {}): Data {
	return {
		schemaVersion: 1, id, owner, enabled: true, opacity: 1, blendMode: 'normal',
		grade: null, processorStackId: null, maskMatteIds: [], ...extra,
	};
}

/** A hand-built fragment: the selector never emits captions or finishing presets. */
function finishing(overrides: Data = {}): Data {
	return {
		schemaVersion: 11, kind: 'framescaper-finishing-fragment',
		originProjectId: ORIGIN_ID, originRevision: ORIGIN_REVISION,
		visual: {
			schemaVersion: 8, kind: 'framescaper-visual-fragment',
			originProjectId: ORIGIN_ID, originRevision: ORIGIN_REVISION,
			sources: [stillSource()], clips: [], adjustmentLayers: [], presets: [],
			maskMattes: [], freezeFallbacks: [],
		},
		colorContexts: [{
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		}],
		sourceColorInterpretations: [
			{
				schemaVersion: 1, sourceId: 'still-source', sourceKind: 'still', primaries: 'display-p3',
				transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'user-override',
			},
			{
				schemaVersion: 1, sourceId: 'video-source', sourceKind: 'video', primaries: 'bt709',
				transfer: 'bt709', matrix: 'bt709', range: 'limited', provenance: 'default-video-bt709-limited',
			},
		],
		visualPresentations: [
			presentation('presentation-source', { kind: 'source', id: 'still-source' }, {
				processorStackId: 'stack-1', maskMatteIds: ['mask-1'],
			}),
			presentation('presentation-clip', { kind: 'clip', id: 'clip-owner' }),
			presentation('presentation-layer', { kind: 'adjustment-layer', id: 'layer-owner' }),
			presentation('presentation-mask', { kind: 'mask-matte', id: 'mask-owner' }),
			presentation('presentation-generator', { kind: 'generator', id: 'still-source' }),
		],
		processorStacks: [{
			schemaVersion: 1, id: 'stack-1', sourceId: 'still-source',
			processors: [
				{
					schemaVersion: 1, id: 'denoise-1', kind: 'spatial-denoise',
					enabled: true, radius: 1, strength: 1,
				},
				{
					schemaVersion: 1, id: 'temporal-1', kind: 'temporal-denoise', enabled: true,
					motionProvider: 'pyramidal-lucas-kanade', analysisId: 'analysis-1',
					radius: 2, strength: 0.5,
				},
			],
		}],
		motionAnalyses: [{
			schemaVersion: 1, id: 'analysis-1', sourceId: 'still-source', processorStackId: 'stack-1',
			inputSha256: SHA_B, settingsSha256: SHA_C, storageKey: `motion-sha256:${SHA_D}`,
			sha256: SHA_D, byteLength: 128, startFrame: 0, endFrame: 10,
		}],
		finishingPresets: [{
			schemaVersion: 1, kind: 'video-finishing-preset', id: 'preset-1', name: 'Look',
			template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null },
		}],
		captionTracks: [{
			schemaVersion: 1, id: 'caption-1', sequenceId: 'main-sequence', name: 'English',
			language: 'en', styles: [], regions: [], speakers: [],
			cues: [{
				schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 10, text: 'Hello',
				styleId: null, regionId: null, speakerId: null, words: [],
			}],
		}],
		...overrides,
	};
}

function map(...pairs: readonly (readonly [string, string])[]): Map<string, string> {
	return new Map(pairs);
}

function referenceMap(...extra: readonly (readonly [string, string])[]): Map<string, string> {
	return map(
		['main-sequence', 'destination-sequence'], ['video-source', 'video-source'],
		['clip-owner', 'destination-clip'], ['layer-owner', 'destination-layer'],
		['mask-owner', 'destination-mask'], ['mask-1', 'destination-mask-matte'], ...extra,
	);
}

function options(overrides: Data = {}): Data {
	return {
		visual: {
			sourceIdMap: map(['still-source', 'fresh-source']),
			clipIdMap: map(), adjustmentLayerIdMap: map(), presetIdMap: map(),
			maskMatteIdMap: map(), projectReferenceIdMap: map(),
		},
		presentationIdMap: map(
			['presentation-source', 'fresh-presentation-1'],
			['presentation-clip', 'fresh-presentation-2'],
			['presentation-layer', 'fresh-presentation-3'],
			['presentation-mask', 'fresh-presentation-4'],
			['presentation-generator', 'fresh-presentation-5'],
		),
		processorStackIdMap: map(['stack-1', 'fresh-stack']),
		processorIdMap: map(['denoise-1', 'fresh-denoise'], ['temporal-1', 'fresh-temporal']),
		motionAnalysisIdMap: map(['analysis-1', 'fresh-analysis']),
		finishingPresetIdMap: map(['preset-1', 'fresh-preset']),
		captionTrackIdMap: map(['caption-1', 'fresh-caption']),
		projectReferenceIdMap: referenceMap(),
		...overrides,
	};
}

function paste(board: Data = finishing(), opts: Data = options()): Data {
	return prepareFramescaperFinishingClipboardPasteV11(board, opts as never) as unknown as Data;
}

function rows(value: Data, key: string): Data[] {
	return value[key] as Data[];
}

function ids(value: Data, key: string): unknown[] {
	return rows(value, key).map((row) => row.id);
}

test('a session clipboard refuses an origin that still holds a nested-sequence graph', () => {
	const nested = nestedSequenceProject();

	assert.throws(
		() => createFramescaperSessionClipboardV11(PROFILE, nested, {} as never),
		{ name: 'Error', message: /cannot preserve a nested-sequence graph/u },
	);
});

test('a session clipboard refuses an origin that still holds a multicamera graph', () => {
	const multicamera = project(multicameraOptions());

	assert.throws(
		() => createFramescaperSessionClipboardV11(PROFILE, multicamera, descriptor(multicamera) as never),
		{ name: 'Error', message: /cannot preserve a multicamera graph/u },
	);
});

test('a finishing-only copy accepts the multicamera origin the session wrapper refuses', () => {
	const multicamera = project(multicameraOptions());

	const fragment = createFramescaperFinishingClipboardV11(
		PROFILE, multicamera, descriptor(multicamera) as never,
	) as unknown as Data;

	assert.equal(fragment.originProjectId, multicamera.id);
	assert.deepEqual(fragment.captionTracks, []);
	assert.deepEqual(fragment.finishingPresets, []);
});

test('a session clipboard refuses a profile the finishing runtime does not admit', () => {
	const source = plainProject();

	assert.throws(
		() => createFramescaperSessionClipboardV11({}, source, descriptor(source) as never),
		TypeError,
	);
});

test('a finishing paste rewrites every owned identity and resolves every project reference', () => {
	const pasted = paste();

	assert.deepEqual(ids(pasted.visual as Data, 'sources'), ['fresh-source']);
	assert.deepEqual(rows(pasted, 'colorContexts').map((row) => row.sequenceId), ['destination-sequence']);
	assert.deepEqual(
		rows(pasted, 'sourceColorInterpretations').map((row) => row.sourceId),
		['fresh-source', 'video-source'],
	);
	assert.deepEqual(ids(pasted, 'motionAnalyses'), ['fresh-analysis']);
	assert.deepEqual(ids(pasted, 'finishingPresets'), ['fresh-preset']);
	assert.deepEqual(rows(pasted, 'motionAnalyses')[0], {
		schemaVersion: 1, id: 'fresh-analysis', sourceId: 'fresh-source', processorStackId: 'fresh-stack',
		inputSha256: SHA_B, settingsSha256: SHA_C, storageKey: `motion-sha256:${SHA_D}`,
		sha256: SHA_D, byteLength: 128, startFrame: 0, endFrame: 10,
	});
});

test('a pasted processor stack renames its processors and follows their analysis allocation', () => {
	const pasted = paste();

	assert.deepEqual(rows(pasted, 'processorStacks')[0], {
		schemaVersion: 1, id: 'fresh-stack', sourceId: 'fresh-source',
		processors: [
			{ schemaVersion: 1, id: 'fresh-denoise', kind: 'spatial-denoise', enabled: true, radius: 1, strength: 1 },
			{
				schemaVersion: 1, id: 'fresh-temporal', kind: 'temporal-denoise', enabled: true,
				motionProvider: 'pyramidal-lucas-kanade', analysisId: 'fresh-analysis', radius: 2, strength: 0.5,
			},
		],
	});
});

test('a pasted presentation owner is resolved through the map that owns its kind', () => {
	const pasted = paste();

	assert.deepEqual(rows(pasted, 'visualPresentations').map(({ id, owner }) => [id, owner]), [
		['fresh-presentation-1', { kind: 'source', id: 'fresh-source' }],
		['fresh-presentation-2', { kind: 'clip', id: 'destination-clip' }],
		['fresh-presentation-3', { kind: 'adjustment-layer', id: 'destination-layer' }],
		['fresh-presentation-4', { kind: 'mask-matte', id: 'destination-mask' }],
		['fresh-presentation-5', { kind: 'generator', id: 'fresh-source' }],
	]);
	const first = rows(pasted, 'visualPresentations')[0]!;
	assert.equal(first.processorStackId, 'fresh-stack');
	assert.deepEqual(first.maskMatteIds, ['destination-mask-matte']);
	assert.equal(rows(pasted, 'visualPresentations')[1]?.processorStackId, null);
});

test('a pasted caption track keeps its cues under a fresh identity and mapped sequence', () => {
	const pasted = paste();

	assert.deepEqual(rows(pasted, 'captionTracks')[0], {
		schemaVersion: 1, id: 'fresh-caption', sequenceId: 'destination-sequence', name: 'English',
		language: 'en', styles: [], regions: [], speakers: [],
		cues: [{
			schemaVersion: 1, id: 'cue-1', startFrame: 0, endFrame: 10, text: 'Hello',
			styleId: null, regionId: null, speakerId: null, words: [],
		}],
	});
});

test('a prepared paste is frozen through every collection it returns', () => {
	const pasted = paste();

	assert.equal(Object.isFrozen(pasted), true);
	assert.equal(Object.isFrozen(pasted.processorStacks), true);
	assert.equal(Object.isFrozen(rows(pasted, 'processorStacks')[0]), true);
	assert.equal(Object.isFrozen(rows(pasted, 'captionTracks')[0]!.cues), true);
});

test('a finishing paste refuses an allocation argument that is not a bounded map', () => {
	assert.throws(
		() => paste(finishing(), options({ captionTrackIdMap: undefined })),
		{ name: 'TypeError', message: /V11 paste captionTrackIdMap must be a bounded map/u },
	);
	assert.throws(
		() => paste(finishing(), options({ visual: undefined })),
		{ name: 'TypeError', message: /V11 paste visual\.sourceIdMap must be a bounded map/u },
	);
	assert.throws(
		() => paste(finishing(), options({ projectReferenceIdMap: {} })),
		{ name: 'TypeError', message: /V11 paste projectReferenceIdMap must be a bounded map/u },
	);
	assert.throws(
		() => paste(finishing(), options({
			finishingPresetIdMap: {
				get: () => undefined, has: () => false, entries: () => [], size: 100_001,
			},
		})),
		{ name: 'TypeError', message: /V11 paste finishingPresetIdMap must be a bounded map/u },
	);
});

test('a finishing paste refuses an allocation target an existing identity already occupies', () => {
	assert.throws(
		() => paste(finishing(), options({
			presentationIdMap: map(
				['presentation-source', 'main-sequence'],
				['presentation-clip', 'fresh-presentation-2'],
				['presentation-layer', 'fresh-presentation-3'],
				['presentation-mask', 'fresh-presentation-4'],
				['presentation-generator', 'fresh-presentation-5'],
			),
		})),
		{ name: 'RangeError', message: /Every V11 paste allocation must be fresh/u },
	);
});

test('a finishing paste refuses two allocations that hand out one fresh identity', () => {
	assert.throws(
		() => paste(finishing(), options({
			finishingPresetIdMap: map(['preset-1', 'shared-fresh']),
			captionTrackIdMap: map(['caption-1', 'shared-fresh']),
		})),
		{ name: 'RangeError', message: /V11 paste allocations must be globally unique/u },
	);
});

test('a finishing paste refuses a project reference that collides with a fresh allocation', () => {
	assert.throws(
		() => paste(finishing(), options({
			projectReferenceIdMap: referenceMap(['main-sequence', 'fresh-source']),
		})),
		{ name: 'RangeError', message: /A V11 project reference cannot collide with a fresh allocation/u },
	);
});

test('a finishing paste refuses an allocation or reference whose identities are unstable', () => {
	assert.throws(
		() => paste(finishing(), options({
			captionTrackIdMap: map(['caption-1', 'fresh-caption'], ['not a stable id', 'fresh-other']),
		})),
		{ name: 'TypeError', message: /V11 allocation source must be a stable project identity/u },
	);
	assert.throws(
		() => paste(finishing(), options({
			captionTrackIdMap: map(['caption-1', 'fresh-caption'], ['caption-2', '']),
		})),
		{ name: 'TypeError', message: /V11 allocation target must be a stable project identity/u },
	);
	assert.throws(
		() => paste(finishing(), options({ projectReferenceIdMap: map(['', 'destination-sequence']) })),
		{ name: 'TypeError', message: /V11 reference source must be a stable project identity/u },
	);
	assert.throws(
		() => paste(finishing(), options({ projectReferenceIdMap: map(['main-sequence', '']) })),
		{ name: 'TypeError', message: /V11 reference target must be a stable project identity/u },
	);
});

test('a finishing paste refuses a processor analysis the carrier never allocated', () => {
	assert.throws(
		() => paste(finishing(), options({ motionAnalysisIdMap: map() })),
		{ name: 'ReferenceError', message: /V11 paste has no mapping for processor analysis analysis-1/u },
	);
});

test('a finishing paste refuses a presentation processor stack the carrier never allocated', () => {
	const board = finishing({
		processorStacks: [], motionAnalyses: [],
		visualPresentations: [presentation('presentation-source', { kind: 'source', id: 'still-source' }, {
			processorStackId: 'stack-missing',
		})],
	});

	assert.throws(
		() => paste(board, options({
			presentationIdMap: map(['presentation-source', 'fresh-presentation-1']),
			processorStackIdMap: map(), processorIdMap: map(), motionAnalysisIdMap: map(),
			projectReferenceIdMap: map(
				['main-sequence', 'destination-sequence'], ['video-source', 'video-source'],
			),
		})),
		{ name: 'ReferenceError', message: /no mapping for presentation processor stack stack-missing/u },
	);
});

test('a finishing paste refuses an allocation or reference nothing in the fragment consumed', () => {
	assert.throws(
		() => paste(finishing(), options({
			captionTrackIdMap: map(['caption-1', 'fresh-caption'], ['caption-unused', 'fresh-unused']),
		})),
		{ name: 'RangeError', message: /V11 paste contains an unused allocation caption-unused/u },
	);
	assert.throws(
		() => paste(finishing(), options({
			projectReferenceIdMap: referenceMap(['ghost-reference', 'destination-ghost']),
		})),
		{ name: 'RangeError', message: /V11 paste contains an unused allocation ghost-reference/u },
	);
});

test('a finishing fragment accepts a null-prototype record and rejects every other shape', () => {
	const nullPrototype = Object.assign(Object.create(null) as Data, finishing());

	assert.equal(normalizeFramescaperFinishingClipboardV11(nullPrototype).schemaVersion, 11);
	for (const value of [null, [], 'fragment', new Map()]) {
		assert.throws(
			() => normalizeFramescaperFinishingClipboardV11(value),
			{ name: 'TypeError', message: /must be a plain record/u },
		);
	}
});

test('a finishing fragment refuses a schema field that is an accessor rather than data', () => {
	const accessor = { ...finishing() };
	delete accessor.captionTracks;
	Object.defineProperty(accessor, 'captionTracks', { get: () => [], enumerable: true, configurable: true });

	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(accessor),
		{ name: 'TypeError', message: /captionTracks must be an own enumerable data property/u },
	);
});

test('a finishing fragment refuses an unstable origin identity or a negative origin revision', () => {
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({ originProjectId: '-leading-dash' })),
		{ name: 'TypeError', message: /originProjectId must be a stable project identity/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({ originRevision: -1 })),
		{ name: 'RangeError', message: /originRevision must be non-negative/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({ originRevision: 1.5 })),
		{ name: 'RangeError', message: /originRevision must be non-negative/u },
	);
});

test('a finishing fragment refuses a collection that is not a bounded array', () => {
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({ visualPresentations: {} })),
		{ name: 'RangeError', message: /V11 visual presentations must be a bounded array/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({
			captionTracks: Array.from({ length: 100_001 }),
		})),
		{ name: 'RangeError', message: /V11 caption tracks must be a bounded array/u },
	);
});

test('a finishing fragment refuses two rows that claim the same owner or identity', () => {
	const board = finishing();
	const context = rows(board, 'colorContexts')[0]!;
	const interpretation = rows(board, 'sourceColorInterpretations')[0]!;

	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({ colorContexts: [context, context] })),
		{ name: 'RangeError', message: /V11 color contexts owners must be unique/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({
			sourceColorInterpretations: [interpretation, interpretation],
		})),
		{ name: 'RangeError', message: /V11 source interpretations owners must be unique/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({
			finishingPresets: [...rows(board, 'finishingPresets'), ...rows(board, 'finishingPresets')],
		})),
		{ name: 'RangeError', message: /V11 finishing presets identities must be unique/u },
	);
	assert.throws(
		() => normalizeFramescaperFinishingClipboardV11(finishing({
			captionTracks: [...rows(board, 'captionTracks'), ...rows(board, 'captionTracks')],
		})),
		{ name: 'RangeError', message: /V11 caption tracks identities must be unique/u },
	);
});

test('a session clipboard refuses an unstable origin identity or a negative origin revision', () => {
	const source = plainProject();
	const board = JSON.parse(JSON.stringify(createFramescaperSessionClipboardV11(
		PROFILE, source, descriptor(source) as never,
	))) as Data;

	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({ ...board, originProjectId: 'has spaces' }),
		{ name: 'TypeError', message: /originProjectId must be a stable project identity/u },
	);
	assert.throws(
		() => normalizeFramescaperSessionClipboardV11({ ...board, originRevision: -2 }),
		{ name: 'RangeError', message: /originRevision must be non-negative/u },
	);
	assert.throws(
		() => normalizeFramescaperSessionClipboardV11([board]),
		{ name: 'TypeError', message: /Framescaper session clipboard V11 must be a plain record/u },
	);
});
