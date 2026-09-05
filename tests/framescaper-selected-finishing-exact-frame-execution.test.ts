/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeVideoMotionV1 } from '../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanFinishing as createPlan,
} from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import {
	bindFramescaperUnifiedRenderTimingSidecarsFinishing as bindSidecars,
} from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import {
	createFramescaperSelectedExactFrameExecutionFinishing as createExecution,
	type FramescaperSelectedExactFrameExecutionFinishing,
} from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority, visualFreshness } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

const WIDTH = 4;
const HEIGHT = 2;
const BYTES = WIDTH * HEIGHT * 4;
const SOURCE_SHA = '12'.repeat(32);

interface Harness {
	readonly execution: FramescaperSelectedExactFrameExecutionFinishing;
	readonly plan: Data;
	readonly captured: Data[];
	readonly effected: { readonly effects: readonly unknown[] }[];
}

function baseOptions(overrides: Data = {}): Data {
	return { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] }, ...overrides };
}

/** Add a solid-colour generator visual clip to the sole video track of the shared fixture. */
function withGenerator(overrides: Data = {}): Data {
	const options = baseOptions(overrides);
	(options.clips as Data[]).push({
		schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	});
	((options.tracks as Data[])[0]!.clipIds as string[]).push('generator-clip');
	options.visualModel = {
		stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
		generatorSources: [{
			schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
			width: WIDTH, height: HEIGHT, frameRate: { num: 10, den: 1 }, frameCount: 100,
			generator: { kind: 'solid', color: '#ff0000ff' },
		}],
		...(overrides.visualModel as Data ?? {}),
	};
	return options;
}

function adjustmentLayer(effectIds: readonly string[] = []): Data {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
		targetTrackIds: ['video-track'], effectIds,
	};
}

function projectOf(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

/** An opaque plate: full alpha keeps painter order observable. */
function frameOf(fill: number): Data {
	const pixels = new Uint8Array(BYTES);
	for (let offset = 0; offset < BYTES; offset += 4) {
		pixels[offset] = fill;
		pixels[offset + 1] = fill;
		pixels[offset + 2] = fill;
		pixels[offset + 3] = 255;
	}
	return { width: WIDTH, height: HEIGHT, pixels };
}

function description(overrides: Data = {}): Data {
	return {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
		}, sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0],
		opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0,
		...overrides,
	};
}

function mediaEntry(overrides: Data = {}): Data {
	return {
		clipId: 'video-clip', sourceId: 'video-source',
		presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		displayWidth: WIDTH, displayHeight: HEIGHT,
		renderDescription: description(), intervalProgress: 0, testFill: 200,
		...overrides,
	};
}

function mediaLayer(entries: readonly Data[] = [mediaEntry()], overrides: Data = {}): Data {
	return { trackId: 'video-track', entries, ...overrides };
}

async function harness(config: Readonly<{
	options?: Data;
	captureFrame?: (entry: Data) => unknown;
	createAcceleratorCanvas?: () => unknown;
	store?: unknown;
	signal?: AbortSignal;
	assertCurrent?: () => void;
}> = {}): Promise<Harness> {
	const project = projectOf(config.options ?? baseOptions());
	const authority = renderAuthority(project as never, 10) as unknown as Data;
	const plan = createPlan(PROFILE, project as never, {
		...authority,
		canvas: { ...(authority.canvas as Data), width: WIDTH, height: HEIGHT },
		visualFreshnessByModelId: visualFreshness(project as never),
	} as never) as unknown as Data;
	const captured: Data[] = [];
	const effected: { readonly effects: readonly unknown[] }[] = [];
	const execution = await createExecution({
		project, plan, timingSidecars: bindSidecars(project, authority.timingViews as never),
		...(config.store === undefined ? {} : { store: config.store }),
		...(config.createAcceleratorCanvas
			? { createAcceleratorCanvas: config.createAcceleratorCanvas } : {}),
		captureFrame: (entry: Data) => {
			captured.push(entry);
			return config.captureFrame ? config.captureFrame(entry) : frameOf(Number(entry.testFill ?? 200));
		},
		applyEffects: (frame: Data, effects: readonly unknown[]) => {
			effected.push({ effects });
			return Promise.resolve(frame);
		},
		signal: config.signal ?? new AbortController().signal,
		assertCurrent: config.assertCurrent ?? (() => undefined),
	} as never);
	return { execution, plan, captured, effected };
}

function renderRequest(overrides: Data = {}): Data {
	return {
		sequencePosition: { num: 0, den: 1 }, layers: [mediaLayer()],
		width: WIDTH, height: HEIGHT, target: new Uint8Array(BYTES),
		signal: new AbortController().signal, ...overrides,
	};
}

function render(execution: FramescaperSelectedExactFrameExecutionFinishing, overrides: Data = {}) {
	return execution.render(renderRequest(overrides) as never);
}

test('a still visual whose bodies have no asset store refuses the execution before any frame', async () => {
	const options = baseOptions();
	(options.clips as Data[]).push({
		schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
	});
	((options.tracks as Data[])[0]!.clipIds as string[]).push('still-clip');
	options.visualModel = {
		stillSources: [{
			schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
			mimeType: 'image/png', storageKey: 'still-storage', contentSha256: 'aa'.repeat(32),
			width: WIDTH, height: HEIGHT, hasAlpha: true,
		}],
		generatorSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
	};

	await assert.rejects(() => harness({ options }), (error: unknown) => (
		error instanceof Error && /visual export assets are unavailable/u.test(error.message)
	));
});

test('an already aborted construction signal is refused with its own abort reason', async () => {
	const controller = new AbortController();
	const reason = new DOMException('operator cancelled the export', 'AbortError');
	controller.abort(reason);

	await assert.rejects(() => harness({ signal: controller.signal }), (error: unknown) => error === reason);
});

test('a construction whose project moved on is refused by its currency assertion', async () => {
	const stale = new Error('the finishing project moved on');

	await assert.rejects(() => harness({ assertCurrent: () => { throw stale; } }),
		(error: unknown) => error === stale);
});

test('a temporal denoise stack attempts the motion accelerator and records why it fell back', async () => {
	const processors = [{
		schemaVersion: 1 as const, id: 'tracking-1', kind: 'tracking' as const, enabled: true,
		maximumFeatures: 16, quality: 0.01, minimumDistance: 2, windowRadius: 2, pyramidLevels: 2,
	}, {
		schemaVersion: 1 as const, id: 'temporal-1', kind: 'temporal-denoise' as const,
		enabled: true, motionProvider: 'pyramidal-lucas-kanade' as const,
		analysisId: 'analysis-1', radius: 1, strength: 0.5,
	}];
	const stack = { schemaVersion: 1 as const, id: 'stack-1', sourceId: 'video-source', processors };
	const analysis = await analyzeVideoMotionV1({
		analysisId: 'analysis-1', inputSha256: SOURCE_SHA, processorStack: stack,
		frames: [0, 1, 2].map((frameNumber) => ({ frameNumber, frame: motionFrame(frameNumber) })),
	} as never);
	const options = baseOptions({
		finishing: {
			visualPresentations: [presentation({ processorStackId: 'stack-1' })],
			processorStacks: [stack], motionAnalyses: [analysis.reference],
		},
	});

	const { execution } = await harness({
		options,
		store: { loadMediaAsset: () => Promise.resolve(new Blob([analysis.bytes])) },
		createAcceleratorCanvas: () => { throw new Error('no WebGL2 canvas in this runtime'); },
	});

	const disposition = execution.acceleratorDisposition();
	assert.equal(disposition.attempted, true);
	assert.equal(disposition.active, false);
	assert.equal(disposition.fallbackReasons.length, 1, 'a refused canvas names exactly one reason');
	await execution.dispose();
});

test('an execution with no motion processors never attempts the accelerator at all', async () => {
	const { execution } = await harness();

	assert.deepEqual(execution.acceleratorDisposition(),
		{ attempted: false, active: false, fallbackReasons: [] });
	await execution.dispose();
});

test('one media layer composites its captured pixels and reports the finishing node consumed', async () => {
	const { execution, plan, captured } = await harness();
	const target = new Uint8Array(BYTES);

	const result = await render(execution, { target });

	assert.deepEqual(result.consumedNodeIds, ['render:finishing:main-sequence']);
	assert.deepEqual(result.openFxDispositions, []);
	assert.equal(result.reportsOpenFxDegradation, false);
	assert.equal(captured.length, 1, 'each admitted entry is captured exactly once');
	assert.equal(captured[0]!.clipId, 'video-clip');
	assert.equal(new Set(target).size, 2, 'an opaque grey plate encodes to one colour plus full alpha');
	assert.equal(target[3], 255);
	assert.ok(Number(target[0]) > 0 && Number(target[0]) < 255);
	const nodeIds = new Set((plan.nodes as Data[]).map(({ nodeId }) => nodeId));
	assert.ok(result.consumedNodeIds.every((nodeId) => nodeIds.has(nodeId)),
		'the export ledger refuses a consumed node its plan never carried');
	await execution.dispose();
});

test('the authored compositing order decides which media entry paints last', async () => {
	const { execution } = await harness();
	const entries = (whiteOrder: number, blackOrder: number) => [
		mediaEntry({ testFill: 255, renderDescription: description({ compositingOrder: whiteOrder }) }),
		mediaEntry({ testFill: 0, renderDescription: description({ compositingOrder: blackOrder }) }),
	];

	const whiteOnTop = new Uint8Array(BYTES);
	await render(execution, { layers: [mediaLayer(entries(1, 0))], target: whiteOnTop });
	const blackOnTop = new Uint8Array(BYTES);
	await render(execution, { layers: [mediaLayer(entries(0, 1))], target: blackOnTop });

	assert.equal(whiteOnTop[0], 255, 'the higher authored order must paint over the lower one');
	assert.equal(blackOnTop[0], 0, 'reversing the authored order reverses the painter result');
	await execution.dispose();
});

test('a generator visual paints over the media on its track and is reported consumed', async () => {
	const { execution } = await harness({ options: withGenerator() });
	const target = new Uint8Array(BYTES);

	const result = await render(execution, { target });

	assert.deepEqual([...target.slice(0, 4)], [255, 0, 0, 255], 'the solid generator owns the canvas');
	assert.deepEqual(result.consumedNodeIds,
		['render:finishing:main-sequence', 'render:visual:generator-clip']);
	await execution.dispose();
});

test('a supplemental picture replaces the visual the plan generated for its clip', async () => {
	const { execution } = await harness({ options: withGenerator() });
	const pixels = new Uint8Array(BYTES);
	for (let offset = 0; offset < BYTES; offset += 4) {
		pixels[offset + 2] = 255;
		pixels[offset + 3] = 255;
	}
	const target = new Uint8Array(BYTES);

	await render(execution, {
		target,
		supplementalPictures: [{
			trackId: 'video-track', clipId: 'generator-clip', sourceId: 'generator-source',
			frame: { width: WIDTH, height: HEIGHT, pixels },
			displayWidth: WIDTH, displayHeight: HEIGHT,
			renderDescription: description({ compositingOrder: 1 }), opacity: 1,
		}],
	});

	assert.deepEqual(
		[...target.slice(0, 4)], [0, 0, 255, 255],
		'the authenticated picture replaces the generator the plan would have drawn',
	);
	await execution.dispose();
});

test('a supplemental picture for a clip the plan never generated is refused', async () => {
	const { execution } = await harness({ options: withGenerator() });

	await assert.rejects(() => render(execution, {
		supplementalPictures: [{
			trackId: 'video-track', clipId: 'ghost-clip', sourceId: 'generator-source',
			frame: frameOf(0), displayWidth: WIDTH, displayHeight: HEIGHT,
			renderDescription: description(), opacity: 1,
		}],
	}), /supplemental picture ghost-clip changed exact visual authority/u);
	await execution.dispose();
});

test('a closed execution refuses further frames', async () => {
	const { execution } = await harness();
	await execution.dispose();
	await execution.dispose();

	await assert.rejects(() => render(execution), /exact frame execution is closed/u);
});

test('a second frame is refused while one is in flight, and so is disposal', async () => {
	let release = (): void => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const { execution } = await harness({
		captureFrame: () => gate.then(() => frameOf(120)),
	});

	const inflight = render(execution);
	await assert.rejects(() => render(execution), /cannot overlap frames/u);
	await assert.rejects(() => execution.dispose(), /exact frame execution is active/u);
	release();
	await inflight;

	await execution.dispose();
	await assert.rejects(() => render(execution), /exact frame execution is closed/u);
});

test('an aborted render signal is refused with its reason and leaves the target untouched', async () => {
	const { execution } = await harness();
	const controller = new AbortController();
	const reason = new DOMException('the frame was superseded', 'AbortError');
	controller.abort(reason);
	const target = new Uint8Array(BYTES).fill(7);

	await assert.rejects(
		() => render(execution, { target, signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.ok(target.every((byte) => byte === 7), 'a refused frame must not clear a target it never took');
	await execution.dispose();
});

test('a geometry the target cannot hold is refused before the target is cleared', async () => {
	const { execution } = await harness();
	const target = new Uint8Array(BYTES + 4).fill(7);

	await assert.rejects(() => render(execution, { target }), (error: unknown) => (
		error instanceof RangeError && /target geometry changed/u.test(error.message)
	));
	await assert.rejects(() => render(execution, { width: 0, target: new Uint8Array(0) }), (error: unknown) => (
		error instanceof RangeError && /frame width must be a positive bounded integer/u.test(error.message)
	));
	assert.ok(target.every((byte) => byte === 7), 'a refused geometry must not clear a caller target');
	await execution.dispose();
});

test('a frame whose project moves on after readback zeroes the target it had accepted', async () => {
	let readback = false;
	const stale = new Error('the finishing project moved on');
	const { execution } = await harness({
		captureFrame: () => { readback = true; return frameOf(180); },
		assertCurrent: () => { if (readback) throw stale; },
	});
	const target = new Uint8Array(BYTES).fill(200);

	await assert.rejects(() => render(execution, { target }), (error: unknown) => error === stale);
	assert.ok(target.every((byte) => byte === 0), 'a stale frame must publish nothing to its caller');
});

test('a clip the plan never admitted is refused and the accepted target is zeroed', async () => {
	const { execution } = await harness();
	const target = new Uint8Array(BYTES).fill(200);

	await assert.rejects(
		() => render(execution, { target, layers: [mediaLayer([mediaEntry({ clipId: 'ghost-clip' })])] }),
		(error: unknown) => error instanceof ReferenceError
			&& /clip ghost-clip is absent from its V13 plan/u.test(error.message),
	);
	assert.ok(target.every((byte) => byte === 0), 'a frame that failed after acceptance must publish nothing');
	await execution.dispose();
});

test('a media entry that changed source authority is refused', async () => {
	const { execution } = await harness();

	await assert.rejects(
		() => render(execution, { layers: [mediaLayer([mediaEntry({ sourceId: 'other-source' })])] }),
		/clip video-clip changed source authority/u,
	);
	await execution.dispose();
});

test('malformed media layers are refused by shape rather than composited', async () => {
	const { execution, captured } = await harness();
	const cases: readonly (readonly [unknown, RegExp, string])[] = [
		['not-an-object', /media layer must be an object/u, 'TypeError'],
		[mediaLayer([], { entries: 'entries' }), /media entries must be an array/u, 'TypeError'],
		[mediaLayer([], { trackId: 5 }), /media track ID is invalid/u, 'TypeError'],
		[
			mediaLayer([mediaEntry({ presentationDescriptor: { drawableSourceFrame: -1, outerCell: 0 } })]),
			/drawable source frame must be non-negative/u, 'RangeError',
		],
		[
			mediaLayer([mediaEntry({ intervalProgress: 2 })]),
			/interval progress must be between zero and one/u, 'RangeError',
		],
		[
			mediaLayer([mediaEntry({ displayWidth: 0 })]),
			/media display width must be a positive bounded integer/u, 'RangeError',
		],
		[
			mediaLayer([mediaEntry({ renderDescription: description({ blendMode: 'burn' }) })]),
			/blend mode is unsupported/u, 'RangeError',
		],
	];

	for (const [layer, pattern, name] of cases) {
		await assert.rejects(() => render(execution, { layers: [layer] }), (error: unknown) => (
			error instanceof Error && error.constructor.name === name && pattern.test(error.message)
		), `${String(pattern)} must refuse its malformed layer`);
	}
	assert.equal(captured.length, 3, 'only refusals downstream of readback may reach source capture');
	await execution.dispose();
});

test('a captured frame whose pixels disagree with its declared geometry is refused', async () => {
	const { execution } = await harness({
		captureFrame: () => ({ width: WIDTH, height: HEIGHT, pixels: new Uint8Array(BYTES - 4) }),
	});

	await assert.rejects(() => render(execution), (error: unknown) => (
		error instanceof RangeError && /captured media frame geometry changed/u.test(error.message)
	));

	const missing = await harness({ captureFrame: () => null });
	await assert.rejects(() => render(missing.execution), (error: unknown) => (
		error instanceof TypeError && /captured media frame must be an RGBA frame/u.test(error.message)
	));
	await execution.dispose();
	await missing.execution.dispose();
});

test('a clip effect is applied to the captured plate before the finishing consumer sees it', async () => {
	const { execution, effected } = await harness();
	const effect = { id: 'effect-1', type: 'pixelate', enabled: true, params: { blockSize: 2 } };

	await render(execution, { layers: [mediaLayer([mediaEntry({ effects: [effect] })])] });

	assert.equal(effected.length, 1, 'the clip runs its own effect stack exactly once');
	assert.deepEqual(effected[0]!.effects, [effect]);
	await execution.dispose();
});

test('an effect owned by an active adjustment layer is applied by the adjustment, not by its clip', async () => {
	const effect = { id: 'effect-1', type: 'pixelate', enabled: true, params: { blockSize: 2 } };
	const options = withGenerator({ visualModel: { adjustmentLayers: [adjustmentLayer(['effect-1'])] } });
	(options.clips as Data[])[0]!.videoEffects = [effect];
	const { execution, effected } = await harness({ options });

	// The caller offers a bare reference; only the plan carries the authored parameters.
	await render(execution, { layers: [mediaLayer([mediaEntry({ effects: [{ id: 'effect-1' }] })])] });

	assert.equal(effected.length, 1, 'the adjustment owns the effect, so the clip must not run it twice');
	assert.deepEqual(effected[0]!.effects, [effect], 'the adjustment resolves the plan-owned effect');
	await execution.dispose();
});

test('an adjustment layer bound to a source processor stack is refused', async () => {
	const options = withGenerator({
		visualModel: { adjustmentLayers: [adjustmentLayer()] },
		finishing: {
			visualPresentations: [presentation({
				id: 'presentation-adjustment', owner: { kind: 'adjustment-layer', id: 'adjustment' },
				processorStackId: 'stack-1',
			})],
			processorStacks: [{
				schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
				processors: [{
					schemaVersion: 1, id: 'spatial-1', kind: 'spatial-denoise',
					enabled: true, radius: 1, strength: 1,
				}],
			}],
		},
	});
	const { execution } = await harness({ options });

	await assert.rejects(
		() => render(execution),
		/adjustment motion requires a source-bound track processor/u,
	);
	await execution.dispose();
});

test('an adjustment cannot flatten a track that carries two blend authorities', async () => {
	const options = withGenerator({ visualModel: { adjustmentLayers: [adjustmentLayer()] } });
	const { execution } = await harness({ options });

	await assert.rejects(() => render(execution, {
		layers: [mediaLayer([
			mediaEntry({ testFill: 255 }),
			mediaEntry({ testFill: 0, renderDescription: description({ blendMode: 'multiply' }) }),
		])],
	}), /adjustment flatten requires one track blend authority/u);
	await execution.dispose();
});

function presentation(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [], ...overrides,
	};
}

function motionFrame(offset: number) {
	const width = 16;
	const height = 16;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 4 + offset; y < 10 + offset; y += 1) {
		for (let x = 4 + offset; x < 10 + offset; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}
