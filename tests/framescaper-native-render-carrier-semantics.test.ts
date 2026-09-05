/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProductVideoExportPlan,
} from '../src/common/editor/controller/product-video-export-strategy.ts';
import type { UnifiedExactRenderPlanV14 } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	assertFramescaperNativeCarrierDispositionNativeMedia as assertDisposition,
	assertFramescaperNativeCarrierFamiliesNativeMedia as assertFamilies,
	assertFramescaperNativeCarrierPlanParityNativeMedia as assertParity,
	framescaperNativeCarrierPictureCanvasNativeMedia as pictureCanvas,
	framescaperNativeCarrierPlanningRateNativeMedia as planningRate,
} from '../src/framescaper/editor-native-render-carrier-semantics.ts';
import {
	createFramescaperNativeRenderPlanAuthorityNativeMedia,
} from '../src/framescaper/editor-native-render-plan-authority.ts';
import {
	createFramescaperProjectNativeMedia,
} from '../src/framescaper/editor-project-native-media.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanNativeMedia,
} from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import type {
	FramescaperVideoExportPictureDispositionFinishing,
} from '../src/framescaper/video-export-visual-execution-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

/** One 2x2, single-frame video project: the smallest plan the V14 authority mints. */
function projectOptions(): Data {
	const options = framescaperV20Options();
	options.sources = (options.sources as Data[]).filter(({ kind }) => kind === 'video').map((source) => ({
		...source, width: 2, height: 2, sourceFrameCount: 1, frameRate: { num: 1, den: 1 },
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
	}));
	options.clips = (options.clips as Data[]).filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = {
		clips: (options.projectBin as { clips: Data[] }).clips
			.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })),
	};
	options.tracks = (options.tracks as Data[]).filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	return options;
}

function fixture() {
	const project = createFramescaperProjectNativeMedia(PROFILE, projectOptions());
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	return { project, plan };
}

/** A detached, mutable copy of an authored plan, ready to be driven off its foundation. */
function mutablePlan(plan: UnifiedExactRenderPlanV14): Data {
	return structuredClone(plan) as unknown as Data;
}

const asPlan = (value: Data) => value as unknown as UnifiedExactRenderPlanV14;

/** A V14 delivery tuple whose every parity-relevant field is stated outright. */
function v14(overrides: Data = {}): UnifiedExactRenderPlanV14 {
	return asPlan({
		version: 14, deliveryProfile: 'encode-mov-prores-422-hq',
		timebase: { sampleStart: 0, sampleDuration: 48_000 },
		format: { container: 'mov', extension: 'mov', mimeType: 'video/quicktime' },
		codecs: {
			video: 'prores', videoEncoder: 'prores_ks',
			audio: null, audioEncoder: null, pixelFormat: 'yuv422p10le',
		},
		output: {
			frameRate: { num: 24, den: 1 }, frameCount: 2, quality: 'balanced',
			canvas: {
				width: 1_920, height: 1_080, fit: 'contain',
				pixelFormat: 'yuv422p10le', backgroundColor: '#00ff00',
			},
		},
		nodes: [], sources: [],
		...overrides,
	});
}

/** The inherited Web picture plan the V14 tuple above is required to agree with. */
function inherited(overrides: Data = {}): ProductVideoExportPlan {
	return {
		version: 3, format: 'mp4', extension: 'mp4', mimeType: 'video/mp4',
		range: { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 },
		canvas: {
			width: 1_920, height: 1_080, frameRate: { num: 24, den: 1 },
			fit: 'contain', backgroundColor: '#00FF00',
		},
		codecs: {
			video: 'h264', videoEncoder: 'libx264',
			audio: null, audioEncoder: null, pixelFormat: 'yuv420p',
		},
		quality: 'balanced', inputs: [], activeSourceIds: [],
		...overrides,
	} as unknown as ProductVideoExportPlan;
}

function withCanvas(overrides: Data): ProductVideoExportPlan {
	const base = inherited().canvas as Data;
	return inherited({ canvas: { ...base, ...overrides } });
}

function withCodecs(overrides: Data): ProductVideoExportPlan {
	const base = inherited().codecs as Data;
	return inherited({ codecs: { ...base, ...overrides } });
}

function disposition(overrides: Data = {}): FramescaperVideoExportPictureDispositionFinishing {
	return {
		exactPlanVersion: 13, nodeDispositions: [], captionDisposition: 'sidecar-only',
		captionTrackIds: [], audioDisposition: 'shared-v21-delivery', originalSourceIds: [],
		unexplainedOmittedNodeIds: [], ...overrides,
	} as unknown as FramescaperVideoExportPictureDispositionFinishing;
}

function openFxNode(nodeId: string, instanceId: string, enabled: boolean): Data {
	return { kind: 'openfx', nodeId, state: { enabled, instanceId, context: 'filter' } };
}

function openFxRow(instanceId: string, outputOrdinal: number, reportsDegradation = false): Data {
	return {
		instanceId, context: 'filter', outputOrdinal, mode: 'rendered',
		reportsDegradation, backend: null, retriedOnCpu: false,
	};
}

/** One clip node plus the two OpenFX nodes every OpenFX disposition case shares. */
function openFxPlan(): UnifiedExactRenderPlanV14 {
	return asPlan({
		output: { frameCount: 2 },
		nodes: [
			{ kind: 'clip', nodeId: 'clip-node' },
			openFxNode('ofx-a', 'instance-a', true),
			openFxNode('ofx-b', 'instance-b', true),
		],
	});
}

const CLIP_ROW = Object.freeze({ nodeId: 'clip-node', kind: 'clip', disposition: 'executed' });

test('a planning rate at or below thirty frames a second is carried through unchanged', () => {
	for (const rate of [{ num: 1, den: 1 }, { num: 24, den: 1 }, { num: 30, den: 1 },
		{ num: 30_000, den: 1_001 }, { num: 60, den: 4 }]) {
		assert.equal(planningRate(rate), rate, `${String(rate.num)}/${String(rate.den)} is already exact`);
	}
});

test('a planning rate above thirty frames a second is clamped to a frozen flat thirty', () => {
	for (const rate of [{ num: 60, den: 1 }, { num: 60_000, den: 1_001 },
		{ num: 120, den: 2 }, { num: 31, den: 1 }]) {
		const clamped = planningRate(rate);
		assert.deepEqual(clamped, { num: 30, den: 1 });
		assert.equal(Object.isFrozen(clamped), true);
		assert.notEqual(clamped, rate);
	}
});

test('an inherited picture canvas is narrowed to its exact size, cadence, fit and background', () => {
	const canvas = pictureCanvas(withCanvas({ backgroundColor: '#00FF00', fit: 'cover' }));

	assert.deepEqual(canvas, {
		width: 1_920, height: 1_080, frameRate: { num: 24, den: 1 },
		fit: 'cover', backgroundColor: '#00FF00',
	});
	assert.equal(Object.isFrozen(canvas), true);
	assert.equal(Object.isFrozen(canvas.frameRate), true);
});

test('an inherited picture canvas that is not a record, or whose cadence is not, is refused', () => {
	for (const canvas of [null, undefined, [], 'canvas', 7]) {
		assert.throws(
			() => pictureCanvas(inherited({ canvas })),
			(error: unknown) => error instanceof TypeError
				&& /inherited picture canvas must be an object/u.test(String(error)),
			`${String(canvas)} is not a canvas record`,
		);
	}
	for (const frameRate of [null, [], 24]) {
		assert.throws(
			() => pictureCanvas(withCanvas({ frameRate })),
			(error: unknown) => error instanceof TypeError
				&& /inherited picture cadence must be an object/u.test(String(error)),
			`${String(frameRate)} is not a cadence record`,
		);
	}
});

test('every out-of-domain inherited canvas dimension, cadence term, fit and background is refused', () => {
	const rejected: readonly Data[] = [
		{ width: 0 }, { width: -1 }, { width: 1.5 }, { width: '1920' }, { width: Number.NaN },
		{ height: 0 }, { height: 2.5 }, { height: null },
		{ frameRate: { num: 0, den: 1 } }, { frameRate: { num: 24, den: 0 } },
		{ frameRate: { num: 23.976, den: 1 } }, { frameRate: { num: 24 } },
		{ fit: 'fill' }, { fit: null }, { backgroundColor: 0x00ff00 }, { backgroundColor: null },
	];
	for (const overrides of rejected) {
		assert.throws(
			() => pictureCanvas(withCanvas(overrides)),
			(error: unknown) => error instanceof TypeError
				&& /inherited picture canvas is invalid/u.test(String(error)),
			`${JSON.stringify(overrides)} must be refused`,
		);
	}
});

test('a disposition that omits inherited exact render nodes without explanation is refused', () => {
	assert.throws(
		() => assertDisposition(asPlan({ output: { frameCount: 1 }, nodes: [] }), disposition({
			unexplainedOmittedNodeIds: ['clip-node'],
		})),
		/Web Core omitted inherited exact render nodes/u,
	);
});

test('a disposition covers exactly the non-professional, non-OpenFX nodes of its plan', () => {
	const plan = asPlan({
		output: { frameCount: 1 },
		nodes: [
			{ kind: 'clip', nodeId: 'clip-node' },
			{ kind: 'finishing', nodeId: 'finishing-node' },
			{ kind: 'professional-media', nodeId: 'pm-node' },
			openFxNode('ofx-a', 'instance-a', false),
		],
	});
	const covered = [CLIP_ROW, { nodeId: 'finishing-node', kind: 'finishing', disposition: 'executed' }];

	assert.doesNotThrow(() => assertDisposition(plan, disposition({ nodeDispositions: covered })));
	for (const nodeDispositions of [
		[CLIP_ROW],
		[...covered, { nodeId: 'pm-node', kind: 'professional-media', disposition: 'executed' }],
		[...covered, { nodeId: 'ofx-a', kind: 'openfx', disposition: 'executed' }],
	]) {
		assert.throws(
			() => assertDisposition(plan, disposition({ nodeDispositions })),
			/does not cover its exact V13 semantic projection/u,
			`${String(nodeDispositions.length)} rows must be refused`,
		);
	}
});

test('an OpenFX disposition must report every enabled effect once per output frame', () => {
	const complete = [
		openFxRow('instance-a', 0), openFxRow('instance-a', 1),
		openFxRow('instance-b', 0), openFxRow('instance-b', 1),
	];

	assert.doesNotThrow(() => assertDisposition(openFxPlan(), disposition({
		nodeDispositions: [CLIP_ROW], openFxDispositions: complete,
	})));
	for (const rows of [
		complete.slice(0, 3),
		[...complete, openFxRow('instance-a', 2)],
		complete.map((row) => ({ ...row, context: 'general' })),
		undefined,
	]) {
		assert.throws(
			() => assertDisposition(openFxPlan(), disposition({
				nodeDispositions: [CLIP_ROW], openFxDispositions: rows,
			})),
			/OpenFX disposition does not cover every exact frame node/u,
			`${String(rows?.length)} OpenFX rows must be refused`,
		);
	}
});

test('a disabled OpenFX node is expected in no frame of the carrier disposition', () => {
	const plan = asPlan({
		output: { frameCount: 2 },
		nodes: [{ kind: 'clip', nodeId: 'clip-node' }, openFxNode('ofx-a', 'instance-a', false)],
	});

	assert.doesNotThrow(() => assertDisposition(plan, disposition({
		nodeDispositions: [CLIP_ROW], openFxDispositions: [],
	})));
	assert.throws(
		() => assertDisposition(plan, disposition({
			nodeDispositions: [CLIP_ROW],
			openFxDispositions: [openFxRow('instance-a', 0), openFxRow('instance-a', 1)],
		})),
		/OpenFX disposition does not cover every exact frame node/u,
	);
});

test('the OpenFX degradation summary must agree with the rows it summarizes', () => {
	const rows = (degraded: boolean) => [
		openFxRow('instance-a', 0), openFxRow('instance-a', 1, degraded),
		openFxRow('instance-b', 0), openFxRow('instance-b', 1),
	];
	const check = (openFxDispositions: Data[], reportsOpenFxDegradation: boolean) => () => (
		assertDisposition(openFxPlan(), disposition({
			nodeDispositions: [CLIP_ROW], openFxDispositions, reportsOpenFxDegradation,
		}))
	);

	assert.doesNotThrow(check(rows(true), true));
	assert.doesNotThrow(check(rows(false), false));
	assert.throws(check(rows(true), false), /OpenFX degradation summary is contradictory/u);
	assert.throws(check(rows(false), true), /OpenFX degradation summary is contradictory/u);
});

test('a professional-media node without its plan source or without original authority is refused', () => {
	const { project, plan } = fixture();
	const sourceNodeId = plan.sources[0]!.nodeId;
	for (const node of [
		{ kind: 'professional-media', nodeId: 'pm-node', sourceNodeId: 'no-such-source', exportAuthority: 'original' },
		{ kind: 'professional-media', nodeId: 'pm-node', sourceNodeId, exportAuthority: 'proxy' },
	]) {
		const drifted = mutablePlan(plan);
		drifted.nodes = [...plan.nodes, node];
		assert.throws(
			() => assertFamilies(asPlan(drifted), project),
			(error: unknown) => error instanceof Error
				&& /professional-media original authority is incomplete/u.test(String(error)),
			`${String(node.exportAuthority)} authority must be refused`,
		);
	}
});

test('the authored V14 plan and its own project satisfy the exact V13 carrier foundation', () => {
	const { project, plan } = fixture();

	assert.equal(plan.version, 14);
	assert.doesNotThrow(() => assertFamilies(plan, project));
});

test('verified professional-media and OpenFX nodes project away from the V13 carrier foundation', () => {
	const { project, plan } = fixture();
	const drifted = mutablePlan(plan);
	drifted.nodes = [
		...plan.nodes,
		{
			kind: 'professional-media', nodeId: 'pm-node',
			sourceNodeId: plan.sources[0]!.nodeId, exportAuthority: 'original',
		},
		openFxNode('ofx-node', 'instance-a', true),
	];

	assert.doesNotThrow(() => assertFamilies(asPlan(drifted), project));
});

test('a V14 plan whose carrier clip drifted no longer projects onto its V13 foundation', () => {
	const { project, plan } = fixture();
	const drifted = mutablePlan(plan);
	const nodes = drifted.nodes as Data[];
	const clip = nodes.find(({ kind }) => kind === 'clip');
	assert.ok(clip, 'the authored plan carries a clip node');
	clip.sequenceFrameCount = Number(clip.sequenceFrameCount) + 1;

	assert.throws(
		() => assertFamilies(asPlan(drifted), project),
		(error: unknown) => error instanceof Error
			&& /exceed the exact inherited V13 Web carrier subset/u.test(String(error)),
	);
});

test('a carrier clip with no V13 foundation counterpart is refused by reference', () => {
	const { project, plan } = fixture();
	const drifted = mutablePlan(plan);
	const clip = (drifted.nodes as Data[]).find(({ kind }) => kind === 'clip') as Data;
	drifted.nodes = [...(drifted.nodes as Data[]), { ...clip, nodeId: 'clip-without-foundation' }];

	assert.throws(
		() => assertFamilies(asPlan(drifted), project),
		(error: unknown) => error instanceof ReferenceError
			&& /carrier clip clip-without-foundation has no V13 foundation/u.test(String(error)),
	);
});

test('a V14 delivery tuple agrees with an inherited picture plan built from its own output authority', () => {
	assert.doesNotThrow(() => assertParity(v14(), inherited()));
});

test('the inherited picture cadence is the V14 output rate clamped to the carrier planning rate', () => {
	const fast = v14({ output: { ...v14().output, frameRate: { num: 60, den: 1 } } });

	assert.doesNotThrow(() => assertParity(fast, withCanvas({ frameRate: { num: 30, den: 1 } })));
	assert.throws(
		() => assertParity(fast, withCanvas({ frameRate: { num: 60, den: 1 } })),
		/diverges from immutable V14 output authority/u,
	);
});

test('every inherited picture field that diverges from the V14 output authority is refused', () => {
	const diverged: readonly (readonly [string, ProductVideoExportPlan])[] = [
		['range start', inherited({ range: { startFrame: 1, endFrame: 48_000, durationFrames: 48_000 } })],
		['range duration', inherited({ range: { startFrame: 0, endFrame: 47_999, durationFrames: 47_999 } })],
		['width', withCanvas({ width: 1_918 })],
		['height', withCanvas({ height: 1_082 })],
		['cadence numerator', withCanvas({ frameRate: { num: 25, den: 1 } })],
		['cadence denominator', withCanvas({ frameRate: { num: 24, den: 2 } })],
		['fit', withCanvas({ fit: 'stretch' })],
		['background', withCanvas({ backgroundColor: '#010101' })],
		['quality', inherited({ quality: 'maximum' })],
		['container format', inherited({ format: 'webm' })],
		['video codec', withCodecs({ video: 'vp9' })],
		['video encoder', withCodecs({ videoEncoder: 'libvpx-vp9' })],
		['pixel format', withCodecs({ pixelFormat: 'yuv444p' })],
		['audio codec', withCodecs({ audio: 'aac' })],
		['audio encoder', withCodecs({ audioEncoder: 'aac' })],
	];
	for (const [name, plan] of diverged) {
		assert.throws(
			() => assertParity(v14(), plan),
			(error: unknown) => error instanceof Error
				&& /diverges from immutable V14 output authority/u.test(String(error)),
			`${name} must be refused`,
		);
	}
});

test('the inherited picture plan must carry a codec record at all', () => {
	for (const codecs of [undefined, null, [], 'h264']) {
		assert.throws(
			() => assertParity(v14(), inherited({ codecs })),
			(error: unknown) => error instanceof TypeError
				&& /inherited picture codecs must be an object/u.test(String(error)),
			`${String(codecs)} is not a codec record`,
		);
	}
});

test('a V14 plan whose delivery tuple no longer matches its profile dispatch is refused', () => {
	const base = v14();
	const drifted: readonly (readonly [string, UnifiedExactRenderPlanV14])[] = [
		['muxer', v14({ format: { ...base.format, container: 'mp4' } })],
		['encoder', v14({ codecs: { ...base.codecs, videoEncoder: 'libx264' } })],
		['pixel format', v14({ codecs: { ...base.codecs, pixelFormat: 'yuv420p' } })],
		['canvas pixel format', v14({
			output: { ...base.output, canvas: { ...base.output.canvas, pixelFormat: 'yuv420p' } },
		})],
		['picture codec', v14({ codecs: { ...base.codecs, video: 'h264' } })],
	];
	for (const [name, plan] of drifted) {
		assert.throws(
			() => assertParity(plan, inherited()),
			(error: unknown) => error instanceof Error
				&& /native delivery lost its authenticated V14 profile tuple/u.test(String(error)),
			`${name} must be refused`,
		);
	}
});

test('a V14 plan whose encode profile is no selected native delivery is refused by range', () => {
	assert.throws(
		() => assertParity(v14({ deliveryProfile: 'encode-mp4-h264' }), inherited()),
		(error: unknown) => error instanceof RangeError
			&& /not a selected nativeMedia native delivery/u.test(String(error)),
	);
});

test('an image-sequence delivery keeps its transparent background, image muxer and alpha encoder', () => {
	const base = v14();
	const sequence = (canvas: Data = {}, overrides: Data = {}) => v14({
		deliveryProfile: 'encode-png-sequence',
		format: { container: 'image2', extension: 'png', mimeType: 'image/png' },
		codecs: { ...base.codecs, video: 'png', videoEncoder: 'png', pixelFormat: 'rgba64be' },
		output: {
			...base.output,
			canvas: {
				...base.output.canvas, pixelFormat: 'rgba64be',
				backgroundColor: '#00000000', ...canvas,
			},
		},
		...overrides,
	});

	assert.doesNotThrow(() => assertParity(sequence(), withCanvas({ backgroundColor: '#00000000' })));
	assert.throws(
		() => assertParity(
			sequence({ backgroundColor: '#000000' }), withCanvas({ backgroundColor: '#000000' }),
		),
		/native delivery lost its authenticated V14 profile tuple/u,
	);
});
