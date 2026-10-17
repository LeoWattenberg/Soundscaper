/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan, type NativeMediaPlanFingerprint } from './native-media-plan-canonical-form.ts';
import { normalizeResourcePlanV16 } from './unified-exact-render-plan-normalization.ts';
import { deepFreezeExactRenderValue } from './unified-exact-render-plan-primitives.ts';
import type { UnifiedExactRenderPlan, UnifiedExactRenderNode } from './unified-exact-render-plan.ts';
import type { UnifiedExactRenderClipNodeV2 } from './unified-exact-render-clip-picture-v2.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';

export type UnifiedExactRenderNodeV16 = Exclude<UnifiedExactRenderNode, { kind: 'clip' }> | UnifiedExactRenderClipNodeV2;
export interface UnifiedExactRenderPlanV16 extends Readonly<Record<string, unknown>>,
	Pick<UnifiedExactRenderPlan, 'strategy' | 'project' | 'format' | 'codecs' | 'timebase' | 'output' | 'tracks' | 'sources'> {
	readonly version: 16;
	readonly nodes: readonly UnifiedExactRenderNodeV16[];
}

/** Explicit current Frame resource generation. Legacy creation/assertion and
 * the named9–15 owners retain their original closed picture vocabulary. */
export function createUnifiedExactRenderPlanV16(value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderPlanV16 {
	const normalized = normalizeResourcePlanV16(value, timingSidecars);
	const canonical = canonicalizeNativeMediaPlan(normalized);
	return deepFreezeExactRenderValue(normalizeResourcePlanV16(JSON.parse(canonical) as unknown, timingSidecars));
}

export function assertUnifiedExactRenderPlanV16(value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars): asserts value is UnifiedExactRenderPlanV16 {
	const normalized = normalizeResourcePlanV16(value, timingSidecars);
	if (canonicalizeNativeMediaPlan(value) !== canonicalizeNativeMediaPlan(normalized)) {
		throw new TypeError('A generation16 plan must retain its canonical semantic order and values.');
	}
}

export function canonicalizeUnifiedExactRenderPlanV16(value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars): string {
	assertUnifiedExactRenderPlanV16(value, timingSidecars);
	return canonicalizeNativeMediaPlan(value);
}

export function fingerprintUnifiedExactRenderPlanV16(value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars): NativeMediaPlanFingerprint {
	assertUnifiedExactRenderPlanV16(value, timingSidecars);
	return fingerprintNativeMediaPlan(value);
}
