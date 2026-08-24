/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputOperation } from '../common/editor/controller/product-native-render-input-authority.ts';
import { canonicalizeNativeMediaPlan, fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../common/editor/native-media-plan-envelope-v2.ts';
import type { UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from './editor-native-render-plan-authority-v28.ts';
import { framescaperNativeRenderDeliveryRequestFromPlanV28 } from './editor-native-project-action-requests-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from './editor-project-unified-render-plan-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import type {
	FramescaperNativeRenderInputProducerAuthorityV28,
	FramescaperNativeRenderInputRequestV28,
} from './editor-native-render-input-producer-v28.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PLAN_BYTES = 65_536;

export function admitFramescaperNativeRenderInputAuthorityV28(
	value: unknown,
): FramescaperNativeRenderInputProducerAuthorityV28 {
	const row = record(value, 'selected V28 native render-input authority') as unknown as
		FramescaperNativeRenderInputProducerAuthorityV28;
	if (typeof row.authority?.begin !== 'function' || typeof row.store?.loadMediaAsset !== 'function') {
		throw new TypeError('Selected V28 native render-input authority is incomplete.');
	}
	return row;
}

export function admitFramescaperNativeRenderInputRequestV28(
	value: unknown,
): FramescaperNativeRenderInputRequestV28 {
	const row = record(value, 'selected V28 native render-input request');
	const fields = ['planPayload', 'planFingerprint', 'projectId', 'projectRevision'];
	if (Reflect.ownKeys(row).length !== fields.length || fields.some((field) => !Object.hasOwn(row, field))
		|| typeof row.planPayload !== 'string'
		|| new TextEncoder().encode(row.planPayload).byteLength > MAXIMUM_PLAN_BYTES
		|| typeof row.planFingerprint !== 'string' || !SHA256.test(row.planFingerprint)
		|| typeof row.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(row.projectId)
		|| !Number.isSafeInteger(row.projectRevision) || Number(row.projectRevision) < 0) {
		throw new TypeError('The selected V28 native render-input request is invalid.');
	}
	return Object.freeze({
		planPayload: row.planPayload, planFingerprint: row.planFingerprint,
		projectId: row.projectId, projectRevision: Number(row.projectRevision),
	});
}

export function currentFramescaperNativeRenderProjectV28(
	profile: unknown,
	value: unknown,
	request: FramescaperNativeRenderInputRequestV28,
): FramescaperProjectV28 {
	const project = cloneFramescaperProjectV28(profile, value);
	if (project.id !== request.projectId || project.revision !== request.projectRevision) {
		throw new Error('The selected V28 native render request is stale.');
	}
	return project;
}

export function currentFramescaperNativeRenderPlanV28(
	profile: unknown,
	project: FramescaperProjectV28,
	request: FramescaperNativeRenderInputRequestV28,
): UnifiedExactRenderPlanV14 {
	let parsed: unknown;
	try { parsed = JSON.parse(request.planPayload) as unknown; }
	catch (cause) { throw new TypeError('The selected V28 native render plan is not JSON.', { cause }); }
	const envelope = createNativeMediaPlanEnvelopeV2(parsed);
	if (envelope.planVersion !== 14 || canonicalizeNativeMediaPlan(parsed) !== request.planPayload
		|| envelope.fingerprint !== request.planFingerprint) {
		throw new Error('The selected V28 native render plan has no exact V14 identity.');
	}
	const delivery = framescaperNativeRenderDeliveryRequestFromPlanV28(
		envelope.plan as UnifiedExactRenderPlanV14,
	);
	const expected = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project, delivery), delivery,
	);
	if (canonicalizeNativeMediaPlan(expected) !== request.planPayload
		|| fingerprintNativeMediaPlan(expected).sha256 !== request.planFingerprint) {
		throw new Error('The selected V28 render plan changed from its current project authority.');
	}
	return envelope.plan as UnifiedExactRenderPlanV14;
}

export function assertFramescaperNativeRenderOperationCurrentV28(
	operation: ProductNativeRenderInputOperation,
): void {
	if (operation.signal.aborted) {
		throw operation.signal.reason
			?? new DOMException('V28 carrier production was cancelled.', 'AbortError');
	}
	operation.assertCurrent();
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
