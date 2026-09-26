/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnifiedExactLinearPremultipliedFrameV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import type { OfxContext } from '../src/common/editor/native-ofx-descriptor.ts';
import type { UnifiedExactRenderPlanV13 } from '../src/common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import type { FramescaperOpenFxFrameDispositionNativeMedia } from '../src/framescaper/editor-openfx-frame-graph-native-media.ts';
import {
	createFramescaperSelectedOpenFxCompositionNativeMedia,
} from '../src/framescaper/selected-native-media-openfx-exact-composition.ts';
import type {
	FramescaperSelectedOpenFxExactPlanesNativeMedia,
} from '../src/framescaper/selected-native-media-openfx-exact-planes.ts';

type ApplyRequest = Parameters<FramescaperSelectedOpenFxExactPlanesNativeMedia['apply']>[0];
type ApplyResult = Awaited<ReturnType<FramescaperSelectedOpenFxExactPlanesNativeMedia['apply']>>;

const SIGNAL = new AbortController().signal;

function linear(red: number, green = 0, blue = 0): UnifiedExactLinearPremultipliedFrameV13 {
	return createUnifiedExactLinearPremultipliedFrameV13(2, 1, [red, green, blue, 1]);
}

function rgba(red: number, green = 0, blue = 0): UnifiedExactRenderVisualRgbaV13 {
	return Object.freeze({
		width: 2,
		height: 1,
		pixels: Uint8Array.from([red, green, blue, 255, red, green, blue, 255]),
	});
}

function disposition(
	instanceId: string,
	context: OfxContext,
	reportsDegradation = false,
): FramescaperOpenFxFrameDispositionNativeMedia {
	return Object.freeze({
		instanceId,
		context,
		outputOrdinal: 3,
		mode: 'render',
		reportsDegradation,
		backend: 'cpu',
		retriedOnCpu: false,
	});
}

function plan(nodes: readonly unknown[] = []): UnifiedExactRenderPlanV13 {
	return { version: 13, nodes } as unknown as UnifiedExactRenderPlanV13;
}

function composition(options: Readonly<{
	readonly planes: FramescaperSelectedOpenFxExactPlanesNativeMedia;
	readonly nodes?: readonly unknown[];
	readonly transitionWeights?: readonly Readonly<{
		readonly clipId: string;
		readonly transitionId: string;
		readonly weight: number;
	}>[];
	readonly initialPlanes?: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>;
	readonly maskGraphs?: ReadonlyMap<string, unknown>;
}>) {
	return createFramescaperSelectedOpenFxCompositionNativeMedia({
		planes: options.planes,
		plan: plan(options.nodes),
		outputOrdinal: 3,
		transitionWeights: options.transitionWeights ?? [],
		maskGraphs: options.maskGraphs ?? new Map(),
		maskInputs: new Map(),
		initialPlanes: options.initialPlanes ?? new Map(),
		width: 2,
		height: 1,
		signal: SIGNAL,
	});
}

test('clip effects receive the current source plus exact registered and initial named planes once', async () => {
	const calls: ApplyRequest[] = [];
	const changed = linear(0, 1);
	const effectDisposition = disposition('filter-1', 'filter', true);
	const planes: FramescaperSelectedOpenFxExactPlanesNativeMedia = Object.freeze({
		has: (context: OfxContext, targetId: string) => context === 'filter' && targetId === 'clip-a',
		inputs: () => ['source-a', 'clip-b', 'plate'],
		ordinal: () => 3,
		transition: () => 0,
		apply: (request: ApplyRequest): Promise<ApplyResult> => {
			calls.push(request);
			return Promise.resolve(Object.freeze({
				frame: changed,
				dispositions: Object.freeze([effectDisposition]),
				reportsDegradation: true,
			}));
		},
	});
	const exact = composition({
		planes,
		initialPlanes: new Map([['plate', rgba(0, 0, 255)]]),
	});
	const registered = linear(0.25);
	const primary = linear(0.75);

	await exact.clip(registered, 'clip-b', 'source-b');
	const output = await exact.clip(primary, 'clip-a', 'source-a');

	assert.equal(output, changed);
	assert.equal(calls.length, 1);
	const [call] = calls;
	assert.equal(call?.context, 'filter');
	assert.equal(call?.targetId, 'clip-a');
	assert.equal(call?.outputOrdinal, 3);
	assert.equal(call?.primary?.identity, 'source-a');
	assert.deepEqual(call?.named.map(({ identity }) => identity), ['clip-b', 'plate']);
	assert.deepEqual([...call!.named[0]!.frame.pixels.slice(0, 4)], [64, 0, 0, 255]);
	assert.deepEqual([...call!.named[1]!.frame.pixels.slice(0, 4)], [0, 0, 255, 255]);
	assert.deepEqual(exact.disposition(), {
		effects: [effectDisposition],
		reportsDegradation: true,
	});
});

test('visual effects execute generator and clip contexts in order without double application', async () => {
	const calls: ApplyRequest[] = [];
	const generated = linear(0, 0.5);
	const filtered = linear(0, 0, 0.75);
	const planes: FramescaperSelectedOpenFxExactPlanesNativeMedia = Object.freeze({
		has: (context: OfxContext, targetId: string) => (context === 'generator' && targetId === 'visual-source')
			|| (context === 'filter' && targetId === 'visual-clip'),
		inputs: () => [],
		ordinal: () => 3,
		transition: () => 0,
		apply: (request: ApplyRequest): Promise<ApplyResult> => {
			calls.push(request);
			const frame = request.context === 'generator' ? generated : filtered;
			return Promise.resolve(Object.freeze({
				frame,
				dispositions: Object.freeze([disposition(`effect-${request.context}`, request.context)]),
				reportsDegradation: false,
			}));
		},
	});
	const exact = composition({ planes });

	const output = await exact.visual(linear(0.25), 'visual-clip', 'visual-source');

	assert.equal(output, filtered);
	assert.deepEqual(
		calls.map(({ context, targetId, primary }) => [context, targetId, primary?.identity]),
		[
			['generator', 'visual-source', 'visual-source'],
			['filter', 'visual-clip', 'visual-source'],
		],
	);
	assert.equal(calls[1]?.primary?.frame.pixels[1], 128);
	assert.deepEqual(
		exact.disposition().effects.map(({ instanceId }) => instanceId),
		['effect-generator', 'effect-filter'],
	);
});

test('transition effects replace only their two participants with one authored track entry', async () => {
	const calls: ApplyRequest[] = [];
	const transitioned = linear(0.5, 0.5);
	const transitionDisposition = disposition('transition-effect', 'transition');
	const planes: FramescaperSelectedOpenFxExactPlanesNativeMedia = Object.freeze({
		has: (context: OfxContext, targetId: string) => context === 'transition' && targetId === 'transition-1',
		inputs: () => [],
		ordinal: () => 3,
		transition: (transitionId: string, ordinal: number) => {
			assert.equal(transitionId, 'transition-1');
			assert.equal(ordinal, 3);
			return 0.625;
		},
		apply: (request: ApplyRequest): Promise<ApplyResult> => {
			calls.push(request);
			return Promise.resolve(Object.freeze({
				frame: transitioned,
				dispositions: Object.freeze([transitionDisposition]),
				reportsDegradation: false,
			}));
		},
	});
	const exact = composition({
		planes,
		nodes: [Object.freeze({
			kind: 'transition',
			transition: Object.freeze({ id: 'transition-1' }),
			edges: Object.freeze({
				trackId: 'track-1',
				outgoing: Object.freeze({ clipId: 'clip-out' }),
				incoming: Object.freeze({ clipId: 'clip-in' }),
			}),
		})],
		transitionWeights: [{ clipId: 'clip-out', transitionId: 'transition-1', weight: 0.375 }],
	});
	await exact.clip(linear(1), 'clip-out', 'source-out');
	await exact.clip(linear(0, 1), 'clip-in', 'source-in');
	const tracks = new Map();

	await exact.applyTransitions(tracks);

	assert.equal(exact.omitsDefaultClip('clip-out'), true);
	assert.equal(exact.omitsDefaultClip('clip-in'), true);
	assert.equal(exact.omitsDefaultClip('other-clip'), false);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.primary, null);
	assert.equal(calls[0]?.transitionProgress, 0.625);
	assert.deepEqual(calls[0]?.named.map(({ identity }) => identity), ['clip-out', 'clip-in']);
	assert.deepEqual(tracks.get('track-1'), [{ frame: transitioned, blendMode: 'normal' }]);
	assert.deepEqual(exact.disposition().effects, [transitionDisposition]);
});

test('an unavailable named plane is synthesized from its exact mask graph', async () => {
	const calls: ApplyRequest[] = [];
	const planes: FramescaperSelectedOpenFxExactPlanesNativeMedia = Object.freeze({
		has: (context: OfxContext, targetId: string) => context === 'filter' && targetId === 'clip-a',
		inputs: () => ['source-a', 'half-mask'],
		ordinal: () => 3,
		transition: () => 0,
		apply: (request: ApplyRequest): Promise<ApplyResult> => {
			calls.push(request);
			return Promise.resolve(Object.freeze({
				frame: linear(1),
				dispositions: Object.freeze([]),
				reportsDegradation: false,
			}));
		},
	});
	const graph = Object.freeze({
		schemaVersion: 1,
		id: 'half-mask',
		kind: 'mask',
		inputs: Object.freeze([]),
		nodes: Object.freeze([Object.freeze({
			id: 'shape',
			kind: 'vector-shape',
			shape: 'rectangle',
			x: 0,
			y: 0,
			width: 0.5,
			height: 1,
		})]),
		outputNodeId: 'shape',
	});
	const exact = composition({ planes, maskGraphs: new Map([['half-mask', graph]]) });

	await exact.clip(linear(0.5), 'clip-a', 'source-a');

	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0]?.named.map(({ identity }) => identity), ['half-mask']);
	assert.deepEqual([...calls[0]!.named[0]!.frame.pixels], [255, 255, 255, 255, 0, 0, 0, 0]);
});
