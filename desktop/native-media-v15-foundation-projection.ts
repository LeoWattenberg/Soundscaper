/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Verification-only reuse of the exact V14 foundation sealed inside V15.
 *
 * This module deliberately does not make V15 dispatchable. Caption and
 * companion artifacts need their own authenticated grants, staging, and
 * publication receipts before a native execution route can admit them.
 */

import { canonicalizeNativeMediaSummaryValue } from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanEnvelopeV2,
} from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeMediaPlanEnvelopeV3,
	type NativeMediaPlanEnvelopeV3,
} from '../src/common/editor/native-media-plan-envelope-v3.ts';
import type {
	UnifiedExactRenderPlanV14,
	UnifiedExactRenderPlanV15,
	UnifiedExactRenderTimingSidecars,
} from '../src/common/editor/unified-exact-render-plan.ts';

export type NativeMediaV15FoundationProjectionRefusalCode =
	| 'caption-artifacts-unbound'
	| 'companion-audio-artifacts-unbound';

export class NativeMediaV15FoundationProjectionRefusal extends Error {
	readonly code: NativeMediaV15FoundationProjectionRefusalCode;

	constructor(code: NativeMediaV15FoundationProjectionRefusalCode, message: string) {
		super(message);
		this.name = 'NativeMediaV15FoundationProjectionRefusal';
		this.code = code;
	}
}

export interface NativeMediaV15FoundationProjection {
	readonly sourcePlanFingerprint: string;
	readonly executionFoundation: NativeMediaPlanEnvelopeV2 & Readonly<{
		readonly planVersion: 14;
		readonly plan: UnifiedExactRenderPlanV14;
	}>;
}

/**
 * Validate an exact V15 envelope and derive the independently validated V14
 * foundation used to compare native rendering semantics. The result is not a
 * queue or execution admission token.
 */
export function projectNativeMediaV15FoundationForV14Verification(
	value: unknown,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): NativeMediaV15FoundationProjection {
	assertNativeMediaPlanEnvelopeV3(value, timingSidecars);
	if (value.planVersion !== 15 || value.plan.version !== 15) {
		throw new RangeError('V15 foundation verification requires an exact V15 envelope.');
	}
	if (value.plan.captionDelivery !== null) {
		throw new NativeMediaV15FoundationProjectionRefusal(
			'caption-artifacts-unbound',
			'V15 caption artifacts have no authenticated native execution binding.',
		);
	}
	if (value.plan.companionAudio !== null) {
		throw new NativeMediaV15FoundationProjectionRefusal(
			'companion-audio-artifacts-unbound',
			'V15 companion audio has no authenticated native execution binding.',
		);
	}

	const executionFoundation = createNativeMediaPlanEnvelopeV2(
		v14Foundation(value.plan),
		timingSidecars,
	);
	if (executionFoundation.planVersion !== 14 || executionFoundation.plan.version !== 14) {
		throw new Error('V15 foundation projection did not produce an exact V14 envelope.');
	}
	assertEquivalentFoundationSummary(value, executionFoundation);

	return Object.freeze({
		sourcePlanFingerprint: value.fingerprint,
		executionFoundation: executionFoundation as NativeMediaV15FoundationProjection['executionFoundation'],
	});
}

function v14Foundation(plan: UnifiedExactRenderPlanV15): UnifiedExactRenderPlanV14 {
	const candidate = structuredClone(plan) as unknown as Record<string, unknown>;
	candidate.version = 14;
	delete candidate.captionDelivery;
	delete candidate.companionAudio;
	return candidate as unknown as UnifiedExactRenderPlanV14;
}

function assertEquivalentFoundationSummary(
	source: NativeMediaPlanEnvelopeV3,
	foundation: NativeMediaPlanEnvelopeV2,
): void {
	const expected = structuredClone(source.summary) as unknown as Record<string, unknown>;
	expected.planVersion = 14;
	expected.strategy = 'framescaper-unified-exact-v14-native';
	delete expected.captionDelivery;
	delete expected.companionAudio;
	if (canonicalizeNativeMediaSummaryValue(expected)
		!== canonicalizeNativeMediaSummaryValue(foundation.summary)) {
		throw new Error('V15 verification foundation summary diverges from the validated V14 projection.');
	}
}
