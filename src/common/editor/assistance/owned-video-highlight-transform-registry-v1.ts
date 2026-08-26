/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed registry for deterministic owned Framescaper and highlight workflow stages. */

import {
	assembleOwnedHighlightsV1,
	gatherOwnedHighlightSignalsV1,
	rankOwnedHighlightsV1,
} from './owned-highlight-workflow-transforms-v1.ts';
import {
	ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1,
	type AssistanceOwnedVideoHighlightTransformIdV1,
	type AssistanceOwnedVideoHighlightTransformRequestV1,
	type AssistanceOwnedVideoHighlightTransformResultByIdV1,
	type AssistanceOwnedVideoHighlightTransformResultV1,
} from './owned-video-highlight-transform-types-v1.ts';
import { reviewAssistanceOwnedVideoHighlightTransformResultV1 } from
	'./owned-video-highlight-transform-results-v1.ts';
import { ownedExactRecord } from './owned-transform-validation-v1.ts';
import {
	planOwnedCropsV1,
	publishOwnedVideoIndexV1,
	sampleOwnedShotFramesV1,
	trackOwnedSubjectsV1,
} from './owned-video-workflow-transforms-v1.ts';
import {
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from './workflow-settings-v1.ts';

export { ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1 };
export { reviewAssistanceOwnedVideoHighlightTransformResultV1 };
export type {
	AssistanceOwnedVideoHighlightTransformIdV1,
	AssistanceOwnedVideoHighlightTransformRequestV1,
	AssistanceOwnedVideoHighlightTransformResultByIdV1,
	AssistanceOwnedVideoHighlightTransformResultV1,
};

export interface AssistanceOwnedVideoHighlightTransformRegistryV1 {
	readonly transformIds: typeof ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1;
	run<const Id extends AssistanceOwnedVideoHighlightTransformIdV1>(
		request: AssistanceOwnedVideoHighlightTransformRequestV1<Id>,
	): AssistanceOwnedVideoHighlightTransformResultByIdV1[Id];
	run(request: unknown): AssistanceOwnedVideoHighlightTransformResultV1;
}

const ID_SET = new Set<unknown>(ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1);
const WORKFLOW_BY_TRANSFORM = Object.freeze({
	'sample-shot-frames': 'index-video',
	'publish-video-index': 'index-video',
	'track-subjects': 'reframe',
	'plan-crops': 'reframe',
	'gather-signals': 'make-highlights',
	'rank-highlights': 'make-highlights',
	'assemble-highlights': 'make-highlights',
} as const);

export function createAssistanceOwnedVideoHighlightTransformRegistryV1():
	AssistanceOwnedVideoHighlightTransformRegistryV1 {
	const run = (value: unknown): AssistanceOwnedVideoHighlightTransformResultV1 => {
		const request = ownedExactRecord(value, ['schemaVersion', 'transformId', 'settings', 'inputs'],
			'owned video/highlight transform request');
		if (request.schemaVersion !== 1 || !ID_SET.has(request.transformId)) {
			throw new TypeError('The owned video/highlight transform identity is unsupported.');
		}
		const transformId = request.transformId as AssistanceOwnedVideoHighlightTransformIdV1;
		const settings = validateAssistanceWorkflowSettingsV1(
			request.settings, WORKFLOW_BY_TRANSFORM[transformId],
		);
		return reviewAssistanceOwnedVideoHighlightTransformResultV1(
			dispatch(transformId, request.inputs, settings),
		);
	};
	return Object.freeze({ transformIds: ASSISTANCE_OWNED_VIDEO_HIGHLIGHT_TRANSFORM_IDS_V1,
		run: run as AssistanceOwnedVideoHighlightTransformRegistryV1['run'] });
}

function dispatch(
	transformId: AssistanceOwnedVideoHighlightTransformIdV1,
	inputs: unknown,
	settings: AssistanceWorkflowSettingsV1,
): AssistanceOwnedVideoHighlightTransformResultV1 {
	switch (transformId) {
		case 'sample-shot-frames': return result(transformId, {
			'frame-pack': sampleOwnedShotFramesV1(inputs, asSettings(settings, 'index-video')),
		});
		case 'publish-video-index': return result(transformId, {
			'video-index': publishOwnedVideoIndexV1(inputs, asSettings(settings, 'index-video')),
		});
		case 'track-subjects': return result(transformId, {
			'tracked-subjects': trackOwnedSubjectsV1(inputs, asSettings(settings, 'reframe')),
		});
		case 'plan-crops': return result(transformId, {
			'reframe-path': planOwnedCropsV1(inputs, asSettings(settings, 'reframe')),
		});
		case 'gather-signals': return result(transformId, {
			'highlight-signals': gatherOwnedHighlightSignalsV1(
				inputs, asSettings(settings, 'make-highlights'),
			),
		});
		case 'rank-highlights': return result(transformId, {
			'highlight-candidates': rankOwnedHighlightsV1(
				inputs, asSettings(settings, 'make-highlights'),
			),
		});
		case 'assemble-highlights': return result(transformId, {
			'highlight-proposals': assembleOwnedHighlightsV1(
				inputs, asSettings(settings, 'make-highlights'),
			),
		});
	}
}

function result<Id extends AssistanceOwnedVideoHighlightTransformIdV1>(
	transformId: Id,
	outputs: AssistanceOwnedVideoHighlightTransformResultByIdV1[Id]['outputs'],
): AssistanceOwnedVideoHighlightTransformResultByIdV1[Id] {
	return Object.freeze({ schemaVersion: 1, transformId, outputs: Object.freeze(outputs) }) as unknown as
		AssistanceOwnedVideoHighlightTransformResultByIdV1[Id];
}

function asSettings<Id extends AssistanceWorkflowSettingsV1['workflowId']>(
	settings: AssistanceWorkflowSettingsV1,
	workflowId: Id,
): Extract<AssistanceWorkflowSettingsV1, { readonly workflowId: Id }> {
	if (settings.workflowId !== workflowId) {
		throw new TypeError('The owned transform settings belong to another workflow.');
	}
	return settings as Extract<AssistanceWorkflowSettingsV1, { readonly workflowId: Id }>;
}
