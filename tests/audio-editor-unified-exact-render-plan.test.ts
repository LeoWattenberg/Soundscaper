/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertUnifiedExactRenderPlan,
	canonicalizeUnifiedExactRenderPlan,
	createUnifiedExactRenderPlan,
	fingerprintUnifiedExactRenderPlan,
	UNIFIED_EXACT_RENDER_PLAN_VERSIONS,
} from '../src/common/editor/unified-exact-render-plan.ts';
import {
	createUnifiedExactRenderClipExportFrameSource,
	createUnifiedExactRenderClipPreviewConsumer,
	createUnifiedExactRenderOfxRetimerSourceTime,
	createUnifiedExactRenderTransitionExportResolver,
	createUnifiedExactRenderTransitionPreviewResolver,
} from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import {
	assertNativeMediaPlanEnvelopeV1,
	createNativeMediaPlanEnvelopeV1,
	divergentNativeMediaPlanEnvelopeFields,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { UNIFIED_EXACT_RENDER_PLAN_GOLDEN_SHA256 } from './fixtures/unified-exact-render-plan-goldens.ts';
import {
	UNIFIED_SHA_B,
	unifiedExactPlanFixture,
	unifiedExactTimingFixture,
} from './helpers/unified-exact-render-plan-fixture.ts';

test('V9 through V12 carry cumulative closed executable authority', () => {
	assert.deepEqual(UNIFIED_EXACT_RENDER_PLAN_VERSIONS, [9, 10, 11, 12]);
	for (const version of UNIFIED_EXACT_RENDER_PLAN_VERSIONS) {
		const plan = createUnifiedExactRenderPlan(unifiedExactPlanFixture(version));
		assert.equal(plan.version, version);
		assert.doesNotThrow(() => assertUnifiedExactRenderPlan(plan));
		assert.ok(Object.isFrozen(plan));
		assert.ok(Object.isFrozen(plan.nodes));
		assert.equal(canonicalizeUnifiedExactRenderPlan(plan), JSON.stringify(plan));
		const clip = plan.nodes.find((node) => node.kind === 'clip');
		assert.equal(clip?.sourceTimeMapping.intent.version, 6);
		assert.equal(Object.hasOwn(clip ?? {}, 'retimeIntentFingerprint'), false);
		if (version >= 10) {
			const visual = plan.nodes.find((node) => node.kind === 'visual');
			assert.equal(visual?.modelKind, 'solid');
			assert.equal(Object.hasOwn(visual ?? {}, 'authoredFingerprint'), false);
		}
		if (version >= 11) {
			const professional = plan.nodes.find((node) => node.kind === 'professional-media');
			assert.equal(professional?.imageSequence?.inventory.frameCount, 20);
			assert.equal(professional?.proxyAttachment?.originalSha256, plan.sources[0]?.contentSha256);
		}
		if (version >= 12) {
			const effect = plan.nodes.find((node) => node.kind === 'openfx');
			assert.equal(effect?.state.context, 'retimer');
			assert.equal(effect?.state.parameters[0]?.keyframes[0]?.frame, 3);
		}
	}
});

test('one plan-owned exact mapping drives preview, export, and OFX Retimer SourceTime', async () => {
	const plan = createUnifiedExactRenderPlan(unifiedExactPlanFixture(12));
	const timing = unifiedExactTimingFixture();
	const source = createUnifiedExactRenderClipExportFrameSource(plan, 'clip-out', timing);
	const frame = source.frameAt(3);
	assert.equal(frame.pictures[0]?.sourceOrdinal, 3);

	let previewOrdinal = -1;
	const preview = createUnifiedExactRenderClipPreviewConsumer(plan, 'clip-out', timing, {
		pause() {},
		assertCurrent() {},
		present(request) {
			previewOrdinal = request.drawableSourceFrame;
			return Promise.resolve({ mediaTime: request.targetSeconds });
		},
	}, { onPresented() {} });
	assert.deepEqual(await preview.requestFrame({
		outputOrdinal: 3, clipId: 'clip-out', sourceId: 'source-1',
	}), { kind: 'presented' });
	assert.equal(previewOrdinal, frame.pictures[0]?.sourceOrdinal);
	const sourceTime = createUnifiedExactRenderOfxRetimerSourceTime(
		plan, 'ofx-1', 3, timing,
	);
	assert.equal(sourceTime.parameter, 'SourceTime');
	assert.equal(sourceTime.numerator, frame.pictures[0]?.sourceTime.numerator.toString());
	assert.equal(sourceTime.denominator, frame.pictures[0]?.sourceTime.denominator.toString());
	preview.dispose();
});

test('preview and export resolve V22 transitions through one plan-owned contract', () => {
	const plan = createUnifiedExactRenderPlan(unifiedExactPlanFixture(9));
	const preview = createUnifiedExactRenderTransitionPreviewResolver(plan, 'transition-1');
	const exporting = createUnifiedExactRenderTransitionExportResolver(plan, 'transition-1');
	const previewFrame = preview.resolveAtSequencePosition({ num: 6, den: 1 });
	const exportFrame = exporting.resolveAtSequencePosition({ num: 6, den: 1 });

	assert.deepEqual(previewFrame, exportFrame);
	assert.equal(previewFrame.transition.id, 'transition-1');
	assert.equal(previewFrame.outgoingWeight, 0.5);
	assert.equal(previewFrame.incomingWeight, 0.5);
	assert.throws(
		() => preview.resolveAtSequencePosition({ num: 8, den: 1 }),
		/outside|overlap/iu,
	);
	assert.throws(
		() => createUnifiedExactRenderTransitionExportResolver(plan, 'missing'),
		/unavailable/iu,
	);
});

test('later semantics cannot leak into an earlier exact generation', () => {
	for (const [version, laterVersion, kind] of [
		[9, 10, 'visual'],
		[10, 11, 'professional-media'],
		[11, 12, 'openfx'],
	] as const) {
		const plan = unifiedExactPlanFixture(version);
		const nodeValue = unifiedExactPlanFixture(laterVersion).nodes.find((candidate) => candidate.kind === kind);
		assert.throws(
			() => createUnifiedExactRenderPlan({ ...plan, nodes: [...plan.nodes, nodeValue] }),
			/version|generation|requires plan/iu,
		);
	}
	assert.throws(
		() => createUnifiedExactRenderPlan({ ...unifiedExactPlanFixture(9), extension: true }),
		/closed|keys|shape|unsupported field/iu,
	);
});

test('hostile nested fields and broken cross-generation references fail closed', () => {
	const base = unifiedExactPlanFixture(12);
	const cases = [
		mutate(base, (plan) => {
			const clip = node(plan, 'clip');
			clip.sourceTimeMapping = { ...record(clip.sourceTimeMapping), extension: true };
		}),
		mutate(base, (plan) => {
			const transitionValue = node(plan, 'transition');
			record(record(transitionValue.edges).outgoing).clipId = 'missing';
		}),
		mutate(base, (plan) => {
			const professional = node(plan, 'professional-media');
			record(record(professional.imageSequence).inventory).frameCount = 19;
		}),
		mutate(base, (plan) => {
			const effect = node(plan, 'openfx');
			const inputs = record(effect.state).inputs as Record<string, unknown>[];
			inputs[0]!.sourceRef = 'missing';
		}),
		mutate(base, (plan) => {
			const sourceValue = record((plan.sources as unknown[])[0]);
			sourceValue.timing = {
				kind: 'vfr',
				reference: {
					encoding: 'soundscaper-video-timing-v1',
					storageKey: `video-timing-sha256:${UNIFIED_SHA_B}`,
					sha256: UNIFIED_SHA_B, sourceSha256: UNIFIED_SHA_B,
					byteLength: 192, frameCount: 20, timescale: 1,
					finalFrameDurationTicks: '1',
				},
			};
		}),
	];
	for (const candidate of cases) {
		assert.throws(
			() => createUnifiedExactRenderPlan(candidate),
			/closed|field|reference|source|inventory|timing|digest|identity|match/iu,
		);
	}
});

test('transition nodes normalize to the frozen deterministic V22 order', () => {
	const raw = unifiedExactPlanFixture(9);
	const transitions = raw.nodes.filter((nodeValue) => nodeValue.kind === 'transition').reverse();
	let index = 0;
	const reversed = {
		...raw,
		nodes: raw.nodes.map((nodeValue) => (
			nodeValue.kind === 'transition' ? transitions[index++]! : nodeValue
		)),
	};
	const normalized = createUnifiedExactRenderPlan(reversed);
	assert.deepEqual(
		normalized.nodes.filter((nodeValue) => nodeValue.kind === 'transition')
			.map((nodeValue) => nodeValue.transition.id),
		['transition-1', 'transition-2'],
	);
	assert.throws(() => assertUnifiedExactRenderPlan(reversed), /canonical|transition order/iu);
});

test('each generation has a stable canonical golden and exact native-envelope summary', () => {
	for (const version of UNIFIED_EXACT_RENDER_PLAN_VERSIONS) {
		const plan = createUnifiedExactRenderPlan(unifiedExactPlanFixture(version));
		const fingerprint = fingerprintUnifiedExactRenderPlan(plan);
		assert.equal(fingerprint.sha256, UNIFIED_EXACT_RENDER_PLAN_GOLDEN_SHA256[version]);
		assert.equal(fingerprint.byteLength, new TextEncoder().encode(JSON.stringify(plan)).byteLength);
		const web = createNativeMediaPlanEnvelopeV1(plan);
		const native = createNativeMediaPlanEnvelopeV1(JSON.parse(JSON.stringify(plan)));
		assert.deepEqual(web.summary.frameRate, { kind: 'rational', num: 1, den: 1 });
		assert.deepEqual(web.summary.featureNodeCounts, featureCounts(version));
		assert.deepEqual(divergentNativeMediaPlanEnvelopeFields(web, native), []);
		assert.doesNotThrow(() => assertNativeMediaPlanEnvelopeV1(native));
	}
});

function featureCounts(version: 9 | 10 | 11 | 12) {
	return {
		transitions: 2,
		visuals: version >= 10 ? 1 : 0,
		professionalMedia: version >= 11 ? 1 : 0,
		openFx: version >= 12 ? 1 : 0,
		retimedClips: 1,
	};
}

function mutate(
	value: ReturnType<typeof unifiedExactPlanFixture>,
	change: (value: Record<string, unknown>) => void,
) {
	const clone = structuredClone(value) as unknown as Record<string, unknown>;
	change(clone);
	return clone;
}

function node(plan: Record<string, unknown>, kind: string): Record<string, unknown> {
	const result = (plan.nodes as Record<string, unknown>[]).find((candidate) => candidate.kind === kind);
	if (!result) throw new RangeError(`Missing ${kind} fixture node.`);
	return result;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new TypeError('Expected fixture record.');
	return value as Record<string, unknown>;
}
