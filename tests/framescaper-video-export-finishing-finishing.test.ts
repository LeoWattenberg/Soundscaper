/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The export-owned RGBA postprocessor and the digest-bound auxiliary asset loader it depends on.
 * The loader is driven against fabricated finishing nodes so every refusal is observable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperVideoExportFinishingFinishing,
	loadFramescaperVideoExportFinishingAssetsFinishing,
} from '../src/framescaper/video-export-finishing-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const WIDTH = 4;
const HEIGHT = 2;
const BYTES = WIDTH * HEIGHT * 4;
const RATE = Object.freeze({ num: 10, den: 1 });
const SOURCE_SHA = '12'.repeat(32);
const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');

interface Config {
	readonly options?: Data;
	readonly timingViewsBySourceId?: unknown;
	readonly project?: unknown;
	readonly store?: unknown;
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
}

function options(overrides: Data = {}): Data {
	return { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] }, ...overrides };
}

/** A second video source on its own track, so one frame can carry two composited occurrences. */
function compositeOptions(interpretations?: readonly unknown[]): Data {
	const base = options();
	const tracks = base.tracks as Data[];
	(base.sources as Data[]).push(createVideoSource({
		id: 'video-source-b', name: 'Upper', storageKey: 'video-source-b', mimeType: 'video/mp4',
		contentSha256: '34'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10,
		frameRate: { num: 10, den: 1 }, width: WIDTH, height: HEIGHT,
	}) as unknown as Data);
	(base.clips as Data[]).push({
		kind: 'video', id: 'video-clip-b', sourceId: 'video-source-b', title: 'Upper',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	});
	tracks.splice(1, 0, {
		...structuredClone(tracks[0]!), id: 'upper-track', name: 'Upper', clipIds: ['video-clip-b'],
	});
	(base.sequences as Data[])[0]!.trackIds = ['video-track', 'upper-track', 'audio-track'];
	base.videoTransitionsByTrackId = { 'video-track': [], 'upper-track': [] };
	if (interpretations) base.finishing = { sourceColorInterpretations: interpretations };
	return base;
}

function interpretation(sourceId: string, overrides: Data = {}): Data {
	return {
		schemaVersion: 1, sourceId, sourceKind: 'video', primaries: 'bt709', transfer: 'bt709',
		matrix: 'bt709', range: 'limited', provenance: 'default-video-bt709-limited', ...overrides,
	};
}

function presentation(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [], ...overrides,
	};
}

function grade(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
		saturation: 1, lut: null, ...overrides,
	};
}

function exportPlan() {
	return createVideoKeyframeExportPlanV7({
		format: 'mp4', sampleRate: 48_000,
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
		canvas: {
			width: WIDTH, height: HEIGHT, frameRate: RATE, fit: 'contain', pixelFormat: 'yuv420p',
			backgroundColor: '#000000', referenceClipId: 'video-clip', referenceSourceId: 'video-source',
		},
		activeClipIds: ['video-clip'], activeSourceIds: ['video-source'],
		sources: [{
			kind: 'video', id: 'video-source', storageKey: 'video-source',
			mimeType: 'video/mp4', contentSha256: SOURCE_SHA,
		}],
		includeAudio: false,
	});
}

function timingViews(ids: readonly string[] = ['video-source']) {
	return new Map(ids.map((id) => [id, { kind: 'cfr' as const, rate: RATE, frameCount: 10 }]));
}

function postprocessor(config: Config = {}) {
	const project = createFramescaperProjectFinishing(PROFILE, (config.options ?? options()) as never);
	return createFramescaperVideoExportFinishingFinishing({
		profile: PROFILE, project, plan: exportPlan(),
		timingViewsBySourceId: (config.timingViewsBySourceId ?? timingViews()) as never,
		signal: config.signal ?? new AbortController().signal,
		assertCurrent: config.assertCurrent ?? (() => undefined),
	});
}

function occurrence(overrides: Data = {}): Data {
	return {
		clipId: 'video-clip', sourceId: 'video-source',
		presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		...overrides,
	};
}

function pixels(fill: number) {
	return Uint8Array.from({ length: BYTES }, (_ignored, index) => (index % 4 === 3 ? 255 : fill));
}

async function process(
	run: Awaited<ReturnType<typeof postprocessor>>,
	overrides: Data = {},
	signal = new AbortController().signal,
) {
	const rgba = (overrides.rgba as Uint8Array<ArrayBuffer> | undefined) ?? pixels(128);
	await run({
		frame: { layers: [{ clips: [occurrence()] }] },
		width: WIDTH, height: HEIGHT, rgba, signal, ...overrides,
	} as never);
	return rgba;
}

test('the finishing postprocessor rewrites the export frame in place at its declared geometry', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({ signal });

	const rgba = await process(run, {}, signal);

	assert.equal(rgba.byteLength, BYTES);
	assert.equal(rgba[3], 255, 'an opaque plate stays opaque through managed finishing');
});

test('an enabled exposure grade brightens the exact frame the postprocessor publishes', async () => {
	const signal = new AbortController().signal;
	const graded = await postprocessor({
		signal,
		options: options({ finishing: { visualPresentations: [presentation({ grade: grade() })] } }),
	});
	const plain = await postprocessor({ signal });

	const brightened = await process(graded, {}, signal);
	const neutral = await process(plain, {}, signal);

	assert.ok(Number(brightened[0]) > Number(neutral[0]),
		'a one-stop exposure lift must publish brighter pixels than the ungraded finisher');
});

test('construction refuses timing views that are not an authenticated Map', async () => {
	await assert.rejects(
		() => postprocessor({ timingViewsBySourceId: { 'video-source': { kind: 'cfr' } } }),
		(error: unknown) => error instanceof TypeError
			&& /raw authenticated source timing views/u.test(error.message),
	);
});

test('construction refuses an aborted or superseded export with that refusal own reason', async () => {
	const controller = new AbortController();
	const reason = new DOMException('the operator cancelled the export', 'AbortError');
	controller.abort(reason);
	const stale = new Error('the finishing project moved on');

	await assert.rejects(() => postprocessor({ signal: controller.signal }),
		(error: unknown) => error === reason);
	await assert.rejects(() => postprocessor({ assertCurrent: () => { throw stale; } }),
		(error: unknown) => error === stale);
});

test('a frame is refused when its signal is a stranger, and again once the export aborts', async () => {
	const controller = new AbortController();
	const run = await postprocessor({ signal: controller.signal });
	const reason = new DOMException('the export was superseded', 'AbortError');
	const rgba = pixels(64);

	await assert.rejects(() => process(run, { rgba }), (error: unknown) => error instanceof TypeError
		&& /requires its exact export AbortSignal/u.test(error.message));
	controller.abort(reason);
	await assert.rejects(() => process(run, { rgba }, controller.signal),
		(error: unknown) => error === reason);
	assert.ok(rgba.every((byte, index) => byte === (index % 4 === 3 ? 255 : 64)),
		'a refused frame must leave the caller buffer exactly as it was offered');
});

test('a frame with no clip occurrences leaves the caller pixels untouched', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({ signal });
	const rgba = pixels(77);

	const result = await process(run, { frame: { layers: [{ clips: [] }] }, rgba }, signal);

	assert.ok(result.every((byte, index) => byte === (index % 4 === 3 ? 255 : 77)));
});

test('malformed frame layers are refused by shape before any occurrence is resolved', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({ signal });
	const cases: readonly (readonly [unknown, RegExp])[] = [
		[{ layers: 'layers' }, /requires exact frame layers/u],
		[{ layers: ['layer'] }, /layer must be an object/u],
		[{ layers: [{ clips: 'clips' }] }, /layer clips are unavailable/u],
		[{ layers: [{ clips: ['occurrence'] }] }, /occurrence must be an object/u],
	];

	for (const [frame, pattern] of cases) {
		await assert.rejects(() => process(run, { frame }, signal), (error: unknown) => (
			error instanceof TypeError && pattern.test(error.message)
		), `${String(pattern)} must refuse its malformed frame`);
	}
});

test('an occurrence whose clip or source identity left the exact plan is refused', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({ signal });

	for (const overrides of [{ clipId: 'ghost-clip' }, { sourceId: 'audio-source' }]) {
		const frame = { layers: [{ clips: [occurrence(overrides)] }] };
		await assert.rejects(() => process(run, { frame }, signal), (error: unknown) => (
			error instanceof Error && error.constructor === Error
				&& /diverged from its V13 plan/u.test(error.message)
		), `${JSON.stringify(overrides)} must be refused as a plan divergence`);
	}
});

test('occurrence identities and presentation descriptors are refused by their own bounds', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({ signal });
	const cases: readonly (readonly [Data, RegExp, string])[] = [
		[{ clipId: 5 }, /clip must be a bounded identity/u, 'TypeError'],
		[{ presentationDescriptor: null }, /exact presentation must be an object/u, 'TypeError'],
		[
			{ presentationDescriptor: { drawableSourceFrame: -1, outerCell: 0 } },
			/source frame must be non-negative/u, 'RangeError',
		],
		[
			{ presentationDescriptor: { drawableSourceFrame: 0, outerCell: 1.5 } },
			/outer cell must be non-negative/u, 'RangeError',
		],
	];

	for (const [overrides, pattern, name] of cases) {
		const frame = { layers: [{ clips: [occurrence(overrides)] }] };
		await assert.rejects(() => process(run, { frame }, signal), (error: unknown) => (
			error instanceof Error && error.constructor.name === name && pattern.test(error.message)
		), `${String(pattern)} must refuse its malformed occurrence`);
	}
});

test('a composite of two clips sharing one source color context resolves from the first occurrence', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({
		signal, options: compositeOptions(),
		timingViewsBySourceId: timingViews(['video-source', 'video-source-b']),
	});
	const lower = { clips: [occurrence()] };
	const upper = { clips: [occurrence({ clipId: 'video-clip-b', sourceId: 'video-source-b' })] };

	const composite = await process(run, { frame: { layers: [lower, upper] } }, signal);

	assert.deepEqual(composite, await process(run, { frame: { layers: [lower] } }, signal),
		'a shared color context resolves the composite from its first occurrence alone');
});

test('a composite whose clips own an enabled presentation demands per-layer execution', async () => {
	const signal = new AbortController().signal;
	const composite = compositeOptions();
	composite.finishing = { visualPresentations: [presentation({ grade: grade() })] };
	const run = await postprocessor({
		signal, options: composite,
		timingViewsBySourceId: timingViews(['video-source', 'video-source-b']),
	});
	const frame = {
		layers: [
			{ clips: [occurrence(), occurrence({ clipId: 'video-clip-b', sourceId: 'video-source-b' })] },
		],
	};

	await assert.rejects(() => process(run, { frame }, signal),
		/requires per-layer execution for this composite/u);
});

test('a composite whose sources disagree on color context is refused outright', async () => {
	const signal = new AbortController().signal;
	const run = await postprocessor({
		signal,
		options: compositeOptions([
			interpretation('video-source'),
			interpretation('video-source-b', {
				primaries: 'srgb', transfer: 'srgb', matrix: 'rgb', range: 'full',
				provenance: 'user-override',
			}),
		]),
		timingViewsBySourceId: timingViews(['video-source', 'video-source-b']),
	});
	const frame = {
		layers: [
			{ clips: [occurrence(), occurrence({ clipId: 'video-clip-b', sourceId: 'video-source-b' })] },
		],
	};

	await assert.rejects(() => process(run, { frame }, signal),
		/refuses a composite with divergent source color contexts/u);
});

function finishingNode(overrides: Data = {}): Data {
	return { visualPresentations: [], processorStacks: [], motionAnalyses: [], ...overrides };
}

function lutReference(overrides: Data = {}): Data {
	const parsed = parseCubeLutV1(LUT_TEXT);
	return {
		storageKey: 'cube-lut-body', sha256: parsed.sha256, byteLength: parsed.byteLength,
		size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax, ...overrides,
	};
}

function loadAssets(node: Data, request: Config = {}) {
	return loadFramescaperVideoExportFinishingAssetsFinishing({
		project: (request.project ?? { sources: [] }) as never,
		...(request.store === undefined ? {} : { store: request.store as never }),
		signal: request.signal ?? new AbortController().signal,
		assertCurrent: request.assertCurrent ?? (() => undefined),
	}, node as never);
}

/** Records every read so deduplication and signal propagation are observable. */
function recordingStore(bodies: readonly (readonly [string, Uint8Array])[], reads: Data[] = []) {
	const byKey = new Map(bodies);
	return {
		reads,
		loadMediaAsset(storageKey: string, loadOptions?: Readonly<{ signal?: AbortSignal }>) {
			reads.push({ storageKey, signal: loadOptions?.signal });
			const bytes = byKey.get(storageKey);
			return Promise.resolve(bytes === undefined ? null : new Blob([bytes as unknown as BlobPart]));
		},
	};
}

function motionFrame(offset: number) {
	const samples = Array.from({ length: 256 }, (_ignored, index) => {
		const x = index % 16;
		const y = (index - x) / 16;
		return x >= 4 + offset && x < 10 + offset && y >= 4 + offset && y < 10 + offset ? 1 : 0;
	});
	return createGrayVideoFrameV1({ width: 16, height: 16, samples });
}

async function motionFixture() {
	const processors = [{
		schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true, maximumFeatures: 16,
		quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}, {
		schemaVersion: 1, id: 'temporal-1', kind: 'temporal-denoise', enabled: true,
		motionProvider: 'pyramidal-lucas-kanade', analysisId: 'analysis-1', radius: 1, strength: 0.5,
	}];
	const stack = { schemaVersion: 1, id: 'stack-1', sourceId: 'video-source', processors };
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA, processorStack: stack,
		frames: [0, 1].map((frameNumber) => ({ frameNumber, frame: motionFrame(frameNumber) })),
	} as never);
	return { stack, analysis };
}

test('a finishing node whose presentations are disabled loads no auxiliary asset at all', async () => {
	const node = finishingNode({
		visualPresentations: [
			presentation({ enabled: false, grade: grade({ lut: lutReference() }), processorStackId: 'stack-1' }),
		],
		processorStacks: [{ id: 'stack-1', sourceId: 'video-source', processors: [] }],
	});

	const assets = await loadAssets(node);

	assert.equal(assets.luts.size, 0, 'a disabled presentation must not pull its LUT body');
	assert.equal(assets.analyses.size, 0);
	assert.ok(Object.isFrozen(assets));
});

test('auxiliary assets with no store refuse the export before any body is read', async () => {
	const node = finishingNode({ visualPresentations: [presentation({ grade: grade({ lut: lutReference() }) })] });

	await assert.rejects(() => loadAssets(node), (error: unknown) => error instanceof Error
		&& /assets are unavailable in this browser runtime/u.test(error.message));
});

test('a presentation or processor naming an absent stack or analysis is refused by reference', async () => {
	const stack = {
		id: 'stack-1', sourceId: 'video-source',
		processors: [{ id: 'spatial-1', kind: 'similarity-stabilization', enabled: true, analysisId: 'analysis-1' }],
	};

	await assert.rejects(
		() => loadAssets(finishingNode({ visualPresentations: [presentation({ processorStackId: 'ghost-stack' })] })),
		(error: unknown) => error instanceof ReferenceError && /stack is unavailable/u.test(error.message),
	);
	await assert.rejects(
		() => loadAssets(finishingNode({
			visualPresentations: [presentation({ processorStackId: 'stack-1' })], processorStacks: [stack],
		})),
		(error: unknown) => error instanceof ReferenceError
			&& /motion analysis analysis-1 is unavailable/u.test(error.message),
	);
});

test('auxiliary references beyond the browser count or byte bound are refused together', async () => {
	const many = Array.from({ length: 257 }, (_ignored, index) => presentation({
		id: `presentation-${String(index)}`,
		grade: grade({ lut: lutReference({ sha256: String(index).padStart(64, '0') }) }),
	}));
	const huge = presentation({ grade: grade({ lut: lutReference({ byteLength: 512 * 1024 * 1024 + 1 }) }) });

	for (const presentations of [many, [huge]]) {
		await assert.rejects(() => loadAssets(finishingNode({ visualPresentations: presentations })),
			(error: unknown) => error instanceof RangeError
				&& /exceed the browser export bound/u.test(error.message));
	}
});

test('two references sharing one digest but disagreeing on their body are refused as conflicting', async () => {
	const node = finishingNode({
		visualPresentations: [
			presentation({ grade: grade({ lut: lutReference() }) }),
			presentation({ id: 'presentation-2', grade: grade({ lut: lutReference({ storageKey: 'other-key' }) }) }),
		],
	});

	await assert.rejects(() => loadAssets(node), (error: unknown) => error instanceof Error
		&& /has conflicting references/u.test(error.message));
});

test('one cube LUT body is read once per digest and keyed by that digest under the export signal', async () => {
	const controller = new AbortController();
	const store = recordingStore([['cube-lut-body', new TextEncoder().encode(LUT_TEXT)]]);
	const node = finishingNode({
		visualPresentations: [
			presentation({ grade: grade({ lut: lutReference() }) }),
			presentation({ id: 'presentation-2', grade: grade({ lut: lutReference() }) }),
		],
	});

	const assets = await loadAssets(node, { store, signal: controller.signal });

	assert.equal(store.reads.length, 1, 'one digest must not be fetched twice');
	assert.deepEqual(store.reads[0], { storageKey: 'cube-lut-body', signal: controller.signal });
	assert.equal(assets.luts.size, 1);
	assert.equal(assets.luts.get(parseCubeLutV1(LUT_TEXT).sha256)?.size, 2);
});

test('a cube LUT body that is absent, stale or geometrically drifted is refused', async () => {
	const node = (lut: Data) => finishingNode({ visualPresentations: [presentation({ grade: grade({ lut }) })] });
	const whole = recordingStore([['cube-lut-body', new TextEncoder().encode(LUT_TEXT)]]);
	const cases: readonly (readonly [Data, unknown, RegExp])[] = [
		[node(lutReference()), recordingStore([]), /asset cube-lut-body is missing or stale/u],
		[
			node(lutReference()),
			recordingStore([['cube-lut-body', new TextEncoder().encode(`${LUT_TEXT}\n`)]]),
			/asset cube-lut-body is missing or stale/u,
		],
		[
			node(lutReference()),
			{ loadMediaAsset: () => Promise.resolve({ size: parseCubeLutV1(LUT_TEXT).byteLength }) },
			/asset cube-lut-body is missing or stale/u,
		],
		[node(lutReference({ size: 3 })), whole, /geometrically mismatched/u],
	];

	for (const [value, store, pattern] of cases) {
		await assert.rejects(() => loadAssets(value, { store }), (error: unknown) => (
			error instanceof Error && pattern.test(error.message)
		), `${String(pattern)} must refuse its stale body`);
	}
});

test('a project that cannot present its sources as an array refuses the analysis binding', async () => {
	const node = finishingNode({ visualPresentations: [presentation({ grade: grade({ lut: lutReference() }) })] });
	const store = recordingStore([['cube-lut-body', new TextEncoder().encode(LUT_TEXT)]]);

	await assert.rejects(() => loadAssets(node, { store, project: { sources: null } }),
		(error: unknown) => error instanceof TypeError && /sources are unavailable/u.test(error.message));
});

test('a motion analysis body is admitted only against its own source digest', async () => {
	const { stack, analysis } = await motionFixture();
	const reference = analysis.reference as unknown as Data;
	const node = finishingNode({
		visualPresentations: [presentation({ processorStackId: 'stack-1' })],
		processorStacks: [stack], motionAnalyses: [reference],
	});
	const store = recordingStore([[String(reference.storageKey), analysis.bytes]]);
	const sources = [{ id: 'video-source', contentSha256: SOURCE_SHA }];

	const assets = await loadAssets(node, { store, project: { sources } });
	assert.deepEqual(assets.analyses.get('analysis-1'), analysis.bytes);
	assert.equal(assets.luts.size, 0);

	const drifted = [{ id: 'video-source', contentSha256: 'ab'.repeat(32) }];
	await assert.rejects(() => loadAssets(node, { store, project: { sources: drifted } }),
		(error: unknown) => error instanceof RangeError
			&& /stale because its input digest changed/u.test(error.message));
});

test('an export cancelled while its store is reading refuses before the body is admitted', async () => {
	const controller = new AbortController();
	const reason = new DOMException('the export was superseded', 'AbortError');
	const node = finishingNode({ visualPresentations: [presentation({ grade: grade({ lut: lutReference() }) })] });
	const store = {
		loadMediaAsset: () => {
			controller.abort(reason);
			return Promise.resolve(new Blob([new TextEncoder().encode(LUT_TEXT)]));
		},
	};

	await assert.rejects(() => loadAssets(node, { store, signal: controller.signal }),
		(error: unknown) => error === reason);
});
