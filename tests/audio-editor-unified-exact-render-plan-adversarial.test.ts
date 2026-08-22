/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

test('unified exact retime authority rejects forged ordinal rows and duplicate intersections', () => {
	const candidates = [
		mutate(unifiedExactPlanFixture(9), (plan) => {
			const row = wallClockRow(plan);
			row.clippedSourceStartTime = { numerator: '8', denominator: '1' };
		}),
		mutate(unifiedExactPlanFixture(9), (plan) => {
			const row = wallClockRow(plan);
			row.endOutputFrame = Number(row.endOutputFrame) + 1;
		}),
		mutate(unifiedExactPlanFixture(9), (plan) => {
			const intent = curveIntent(plan);
			const intersections = intent.intersections as Record<string, unknown>[];
			const duplicate = structuredClone(intersections.at(-1)!);
			duplicate.index = intersections.length;
			intersections.push(duplicate);
			record(intent.limits).serializedIntersectionCount = intersections.length;
		}),
	];
	for (const candidate of candidates) {
		assert.throws(() => createUnifiedExactRenderPlan(candidate), /retime|ordinal|intersection|authority/iu);
	}
});

test('unified output authority admits only closed codec tuples and bounded encoder work', () => {
	const wrongTuple = mutate(unifiedExactPlanFixture(9), (plan) => {
		record(plan.codecs).video = 'vp9';
		record(plan.codecs).videoEncoder = 'libvpx-vp9';
	});
	const oddCanvas = mutate(unifiedExactPlanFixture(9), (plan) => {
		record(record(plan.output).canvas).width = 1;
		record(record(plan.output).canvas).height = 1;
	});
	const oversizedCanvas = mutate(unifiedExactPlanFixture(9), (plan) => {
		record(record(plan.output).canvas).width = 65_536;
		record(record(plan.output).canvas).height = 65_536;
	});
	for (const candidate of [wrongTuple, oddCanvas, oversizedCanvas]) {
		assert.throws(() => createUnifiedExactRenderPlan(candidate), /codec|format|canvas|encoder|work|geometry/iu);
	}
});

test('unified graph references must target an allowed identity family', () => {
	const externalGenerator = mutate(unifiedExactPlanFixture(10), (plan) => {
		const visual = node(plan, 'visual');
		visual.modelKind = 'external-generator';
		const state = record(visual.authoredState);
		record(state.source).generator = {
			kind: 'external-generator', bindingId: 'project-1',
			inputs: [{ name: 'Source', sourceRef: 'track-1' }],
		};
		visual.freshness = {
			...record(visual.freshness),
			authoredStateSha256: fingerprintNativeMediaPlan(state).sha256,
		};
		visual.authoredFallback = null;
		visual.fallbackDisposition = null;
		visual.frozenFallback = null;
	});
	const mask = mutate(unifiedExactPlanFixture(10), (plan) => {
		const visual = node(plan, 'visual');
		visual.modelId = 'mask-1';
		visual.modelKind = 'mask-matte';
		visual.authoredState = {
			schemaVersion: 1, id: 'mask-1', kind: 'mask',
			inputs: [{ name: 'plate', sourceRef: 'track-1', kind: 'alpha' }],
			nodes: [{ id: 'alpha-1', kind: 'alpha', inputName: 'plate' }],
			outputNodeId: 'alpha-1',
		};
		visual.placement = null;
		visual.freshness = {
			...record(visual.freshness),
			authoredStateSha256: fingerprintNativeMediaPlan(visual.authoredState).sha256,
		};
		visual.authoredFallback = null;
		visual.fallbackDisposition = null;
		visual.frozenFallback = null;
	});
	const openFx = mutate(unifiedExactPlanFixture(12), (plan) => {
		const state = record(node(plan, 'openfx').state);
		record(state.attachment).targetId = 'project-1';
		(state.inputs as Record<string, unknown>[])[0]!.sourceRef = 'track-1';
	});
	for (const candidate of [externalGenerator, mask, openFx]) {
		assert.throws(() => createUnifiedExactRenderPlan(candidate), /identity|target|input|binding|family/iu);
	}
});

test('V11 permits at most one professional-media authority per source', () => {
	const duplicate = mutate(unifiedExactPlanFixture(11), (plan) => {
		const copy = structuredClone(node(plan, 'professional-media'));
		copy.nodeId = 'professional-copy';
		(plan.nodes as Record<string, unknown>[]).push(copy);
	});
	assert.throws(() => createUnifiedExactRenderPlan(duplicate), /professional.*source|source.*professional|duplicate/iu);
});

test('VFR unified admission fails closed until verified timing bytes participate', () => {
	const candidate = mutate(unifiedExactPlanFixture(9), (plan) => {
		const source = (plan.sources as Record<string, unknown>[])[0]!;
		source.timing = {
			kind: 'vfr',
			reference: {
				encoding: 'soundscaper-video-timing-v1',
				storageKey: `video-timing-sha256:${'ef'.repeat(32)}`,
				sha256: 'ef'.repeat(32), sourceSha256: source.contentSha256,
				byteLength: 192, frameCount: 20, timescale: 1,
				finalFrameDurationTicks: '1',
			},
		};
	});
	assert.throws(() => createUnifiedExactRenderPlan(candidate), /VFR|timing bytes|timing asset/iu);
});

function mutate(value: unknown, change: (record: Record<string, unknown>) => void): unknown {
	const result = structuredClone(value) as Record<string, unknown>;
	change(result);
	return result;
}

function node(plan: Record<string, unknown>, kind: string): Record<string, unknown> {
	const result = (plan.nodes as Record<string, unknown>[]).find((candidate) => candidate.kind === kind);
	if (!result) throw new RangeError(`Missing ${kind} fixture node.`);
	return result;
}

function wallClockRow(plan: Record<string, unknown>): Record<string, unknown> {
	const clip = (plan.nodes as Record<string, unknown>[]).find((candidate) => (
		candidate.kind === 'clip' && record(candidate.sourceTimeMapping).retimeMap === null
	));
	if (!clip) throw new RangeError('Missing wall-clock clip fixture.');
	return (record(record(clip.sourceTimeMapping).intent).intersections as Record<string, unknown>[])[0]!;
}

function curveIntent(plan: Record<string, unknown>): Record<string, unknown> {
	const clip = (plan.nodes as Record<string, unknown>[]).find((candidate) => (
		candidate.kind === 'clip' && record(candidate.sourceTimeMapping).retimeMap !== null
	));
	if (!clip) throw new RangeError('Missing curve clip fixture.');
	return record(record(clip.sourceTimeMapping).intent);
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Expected fixture record.');
	}
	return value as Record<string, unknown>;
}
