/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveUnifiedExactOfxFreshnessV26 } from '../src/common/editor/native-ofx-freshness-authority.ts';
import {
	createUnifiedExactRenderPlan,
	type UnifiedExactRenderOpenFxNode,
} from '../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

test('V26 freshness is derived from authored state, source identities, plan intent, and native identity', () => {
	const raw = structuredClone(unifiedExactPlanFixture(12));
	const initial = createUnifiedExactRenderPlan(raw);
	const observed = deriveUnifiedExactOfxFreshnessV26(initial, 'ofx-1', descriptor());
	const rawEffect = raw.nodes.find((node) => node.kind === 'openfx');
	if (!rawEffect || rawEffect.state.frozenFallback === null) throw new Error('fallback fixture unavailable');
	rawEffect.state.freshness = observed;
	rawEffect.state.frozenFallback.freshness = observed;
	const bound = createUnifiedExactRenderPlan(raw);
	assert.deepEqual(deriveUnifiedExactOfxFreshnessV26(bound, 'ofx-1', descriptor()), observed);

	const changed = structuredClone(raw);
	const changedEffect = changed.nodes.find((node) => node.kind === 'openfx');
	if (!changedEffect) throw new Error('effect fixture unavailable');
	changedEffect.state.parameters[0]!.value = [0.25];
	const changedPlan = createUnifiedExactRenderPlan(changed);
	assert.notEqual(
		deriveUnifiedExactOfxFreshnessV26(changedPlan, 'ofx-1', descriptor()).authoredStateSha256,
		observed.authoredStateSha256,
	);
	assert.equal(effect(bound).state.frozenFallback?.freshness.authoredStateSha256,
		observed.authoredStateSha256);
});

function effect(plan: ReturnType<typeof createUnifiedExactRenderPlan>): UnifiedExactRenderOpenFxNode {
	const value = plan.nodes.find((node): node is UnifiedExactRenderOpenFxNode => node.kind === 'openfx');
	if (!value) throw new Error('effect fixture unavailable');
	return value;
}

function descriptor() {
	return {
		pluginId: 'net.example.Retimer', vendor: 'Example', version: { major: 1, minor: 0 },
		bundleIdentity: 'sha256:bundle', binarySha256: 'a7'.repeat(32),
		architectureDirectory: 'Linux-x86-64', supportedContexts: ['retimer'],
		parameters: [{ name: 'speed', type: 'double', animates: true }],
		components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
		requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite'],
	};
}
