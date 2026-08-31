/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertUnifiedExactRenderPlanV12,
	createUnifiedExactRenderPlan,
	createUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV12,
} from '../../src/common/editor/unified-exact-render-plan.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../../src/common/editor/native-media-plan-video-timing.ts';
import type { OfxEffectStateV26 } from '../../src/common/editor/native-ofx-state-v26.ts';
import { createUnifiedExactRenderOfxRetimerSourceTime } from '../../src/common/editor/unified-exact-render-plan-consumers.ts';
import { unifiedExactPlanFixture } from './unified-exact-render-plan-fixture.ts';
import { unifiedExactVfrPlanFixture } from './unified-exact-vfr-plan-fixture.ts';

export const PLUGIN_SHA = '16b3c51f93a8ee62dda14918f2089518fe054144d2016b177c57c7bc66d07af7';

export function retimerVfrCandidate() {
	const fixture = unifiedExactVfrPlanFixture(12, '77'.repeat(32));
	const raw = structuredClone(fixture.plan);
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	const effect = structuredClone(unifiedExactPlanFixture(12).nodes.find(({ kind }) => kind === 'openfx'));
	if (!effect || !('state' in effect)) throw new Error('The OpenFX fixture is unavailable.');
	Object.assign(effect.state as object, {
		pluginId: 'org.framescaper.conformance', binarySha256: PLUGIN_SHA,
		context: 'retimer', attachment: { kind: 'retimer', targetId: 'vfr-clip' },
		inputs: [{ name: 'Source', sourceRef: 'vfr-source' }], parameters: [],
		frozenFallback: null,
	});
	(raw.nodes as unknown as object[]).push(effect);
	const plan = createUnifiedExactRenderPlanWithTimingSidecars(
		raw, fixture.timingSidecars,
	) as UnifiedExactRenderPlanV12;
	if (plan.version !== 12) throw new Error('The VFR OpenFX fixture did not create V12.');
	const input = nativeMediaPlanVideoTimingAssetInputs(plan)[0];
	if (!input) throw new Error('The VFR OpenFX fixture has no timing reference.');
	return Object.freeze({
		plan,
		assets: Object.freeze([{ input, bytes: fixture.publication.bytes }]),
		sourceTime: createUnifiedExactRenderOfxRetimerSourceTime(
			plan, 'ofx-1', 2, fixture.timingSidecars,
		),
	});
}

export function candidatePlan(): UnifiedExactRenderPlanV12 {
	const raw = structuredClone(unifiedExactPlanFixture(12));
	raw.output.canvas.width = 2;
	raw.output.canvas.height = 2;
	const effect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!effect || !('state' in effect)) throw new Error('fixture effect is unavailable');
	Object.assign(effect.state as object, {
		pluginId: 'org.framescaper.conformance', binarySha256: PLUGIN_SHA,
		context: 'filter', attachment: { kind: 'filter', targetId: 'clip-out' },
		parameters: [{ name: 'radius', type: 'double', value: [1],
			keyframes: [{ frame: 3, value: 0.5 }] }],
	});
	const plan = createUnifiedExactRenderPlan(raw);
	assertUnifiedExactRenderPlanV12(plan);
	return plan;
}

export function interactEffect(plan: UnifiedExactRenderPlanV12): OfxEffectStateV26 {
	const node = plan.nodes.find((candidate) => candidate.kind === 'openfx');
	if (!node || node.kind !== 'openfx') throw new Error('The OpenFX fixture effect is unavailable.');
	return structuredClone(node.state);
}
