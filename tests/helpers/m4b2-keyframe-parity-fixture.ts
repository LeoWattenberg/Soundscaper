/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	M4B2_KEYFRAME_PARITY_FIXTURE_ID,
	M4B2_KEYFRAME_PARITY_OBSERVATION_CLASS,
	M4B2_KEYFRAME_PARITY_PROFILE,
	M4B2_KEYFRAME_PARITY_SPECIFICATION,
	M4B2_KEYFRAME_PARITY_WORKLOAD_ID,
	createM4B2KeyframeParitySourceRgba,
	m4b2KeyframeParityCases,
	m4b2KeyframeParityOperationId,
} from '../../src/common/editor/quality/m4b2-keyframe-parity-workload.ts';
import { createM4B2KeyframeParityExpectedRgba } from '../../scripts/lib/m4b2-keyframe-parity-metrics.mjs';

type Outcome = 'rendered' | 'substituted' | 'fallback' | 'omitted';

export function makeM4B2KeyframeParityDiagnostic(
	overrides: Readonly<{ readonly outcome?: Outcome; readonly operationId?: string }> = {},
): Record<string, unknown> {
	const bytes = createM4B2KeyframeParitySourceRgba();
	const encoded = Buffer.from(bytes).toString('base64');
	return {
		schemaVersion: 1,
		profile: M4B2_KEYFRAME_PARITY_PROFILE,
		observationClass: M4B2_KEYFRAME_PARITY_OBSERVATION_CLASS,
		workloadId: M4B2_KEYFRAME_PARITY_WORKLOAD_ID,
		fixtureId: M4B2_KEYFRAME_PARITY_FIXTURE_ID,
		environmentId: 'local-browser-correctness',
		rendererClass: 'hardware',
		environmentFingerprint: {
			browserVersion: 'Chromium 149.0.7827.55',
			platform: 'linux',
			architecture: 'x64',
			webglVendor: 'diagnostic-vendor',
			webglRenderer: 'diagnostic-gpu',
		},
		fixture: structuredClone(M4B2_KEYFRAME_PARITY_SPECIFICATION),
		sourceBase64: encoded,
		cases: m4b2KeyframeParityCases().map((definition) => ({
			id: definition.id,
			curveKind: definition.curveKind,
			targetId: definition.targetId,
			clipId: definition.evidenceClipId,
			presentationClass: definition.presentationClass,
			presentationIdentity: `sha256:${M4B2_KEYFRAME_PARITY_SPECIFICATION.sourceSha256}`,
			queries: definition.queries.map((query) => {
				const operationId = m4b2KeyframeParityOperationId(definition.id, query.id);
				const rendered = Buffer.from(createM4B2KeyframeParityExpectedRgba(
					bytes,
					query.expectedPresentation.drawableSourceFrame,
					query.expectedValue,
					M4B2_KEYFRAME_PARITY_SPECIFICATION.width,
					M4B2_KEYFRAME_PARITY_SPECIFICATION.height,
				)).toString('base64');
				const outcome = operationId === overrides.operationId
					? overrides.outcome ?? 'rendered'
					: 'rendered';
				const clipId = definition.evidenceClipId;
				return {
					id: query.id,
					frameIndex: query.frameIndex,
					position: query.position,
					previewPresentation: structuredClone(query.expectedPresentation),
					offlinePresentation: structuredClone(query.expectedPresentation),
					previewBase64: rendered,
					offlineBase64: rendered,
					preview: consumer(operationId, clipId, outcome, query.expectedValue),
					offline: consumer(operationId, clipId, outcome, query.expectedValue),
				};
			}),
		})),
	};
}

function consumer(
	operationId: string,
	clipId: string,
	outcome: Outcome,
	stateValue: number,
): Record<string, unknown> {
	const rendered = outcome === 'rendered' || outcome === 'substituted';
	const fallback = outcome === 'fallback';
	const omitted = outcome === 'omitted';
	return {
		operationId,
		stateValue: rendered ? stateValue : null,
		outcomes: {
			requested: [operationId],
			rendered: outcome === 'rendered' ? [operationId] : [],
			substituted: outcome === 'substituted' ? [operationId] : [],
			fallback: fallback ? [operationId] : [],
			omitted: omitted ? [operationId] : [],
		},
		renderReport: {
			status: rendered ? 'rendered' : 'fallback',
			rendererStatus: fallback ? 'failed' : 'available',
			renderedEntryCount: rendered ? 1 : 0,
			effects: { requested: [], rendered: [], fallbackRendered: [], omitted: [] },
			composition: {
				requested: [{ clipId, blendMode: 'normal' }],
				rendered: rendered ? [clipId] : [],
				fallbackRendered: fallback ? [clipId] : [],
				omitted: omitted ? [clipId] : [],
			},
		},
	};
}
