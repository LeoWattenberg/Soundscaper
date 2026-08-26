/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed registry for the deterministic owned audio and cut workflow stages. */

import {
	assembleOwnedCaptionsV1,
	attributeOwnedSpeakersV1,
	chunkOwnedTranscriptV1,
	mergeOwnedReactionRangesV1,
	proposeOwnedCleanupV1,
	proposeOwnedTempoMapV1,
	publishOwnedTranscriptIndexV1,
} from './owned-audio-workflow-transforms-v1.ts';
import {
	ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1,
	type AssistanceOwnedAudioCutTransformIdV1,
	type AssistanceOwnedAudioCutTransformRequestV1,
	type AssistanceOwnedAudioCutTransformResultByIdV1,
	type AssistanceOwnedAudioCutTransformResultV1,
} from './owned-audio-cut-transform-types-v1.ts';
import { reviewAssistanceOwnedAudioCutTransformResultV1 } from
	'./owned-audio-cut-transform-results-v1.ts';
import { normalizeOwnedCutsV1 } from './owned-cut-workflow-transform-v1.ts';
import { ownedExactRecord } from './owned-transform-validation-v1.ts';
import type { AssistanceTokenizerV1 } from './transcript-indexing-v1.ts';
import {
	validateAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1,
} from './workflow-settings-v1.ts';

export { ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1 };
export { reviewAssistanceOwnedAudioCutTransformResultV1 };
export type {
	AssistanceOwnedAudioCutTransformIdV1,
	AssistanceOwnedAudioCutTransformRequestV1,
	AssistanceOwnedAudioCutTransformResultByIdV1,
	AssistanceOwnedAudioCutTransformResultV1,
};

export interface AssistanceOwnedAudioCutTransformRegistryOptionsV1 {
	/** Exact tokenizer installed alongside the transcript embedder, or null when unavailable. */
	readonly tokenizer: AssistanceTokenizerV1 | null;
}

export interface AssistanceOwnedAudioCutTransformRegistryV1 {
	readonly transformIds: typeof ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1;
	run<const Id extends AssistanceOwnedAudioCutTransformIdV1>(
		request: AssistanceOwnedAudioCutTransformRequestV1<Id>,
	): AssistanceOwnedAudioCutTransformResultByIdV1[Id];
	run(request: unknown): AssistanceOwnedAudioCutTransformResultV1;
}

const ID_SET = new Set<unknown>(ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1);
const WORKFLOW_BY_TRANSFORM = Object.freeze({
	'assemble-captions': 'transcribe-captions',
	'propose-cleanup': 'clean-filler-silence',
	'attribute-speakers': 'identify-speakers',
	'merge-reaction-ranges': 'mark-reactions',
	'chunk-transcript': 'index-transcript',
	'publish-transcript-index': 'index-transcript',
	'propose-tempo-map': 'detect-beats-tempo',
	'normalize-cuts': 'mark-cuts',
} as const);

export function createAssistanceOwnedAudioCutTransformRegistryV1(
	optionsValue: AssistanceOwnedAudioCutTransformRegistryOptionsV1,
): AssistanceOwnedAudioCutTransformRegistryV1 {
	const options = ownedExactRecord(optionsValue, ['tokenizer'], 'owned transform registry options');
	if (options.tokenizer !== null && (!options.tokenizer || typeof options.tokenizer !== 'object'
		|| typeof (options.tokenizer as AssistanceTokenizerV1).encode !== 'function')) {
		throw new TypeError('The owned transform registry tokenizer adapter is invalid.');
	}
	const tokenizer = options.tokenizer as AssistanceTokenizerV1 | null;
	const run = (value: unknown): AssistanceOwnedAudioCutTransformResultV1 => {
		const request = ownedExactRecord(value, ['schemaVersion', 'transformId', 'settings', 'inputs'],
			'owned audio/cut transform request');
		if (request.schemaVersion !== 1 || !ID_SET.has(request.transformId)) {
			throw new TypeError('The owned audio/cut transform identity is unsupported.');
		}
		const transformId = request.transformId as AssistanceOwnedAudioCutTransformIdV1;
		const settings = validateAssistanceWorkflowSettingsV1(
			request.settings, WORKFLOW_BY_TRANSFORM[transformId],
		);
		return reviewAssistanceOwnedAudioCutTransformResultV1(dispatch(
			transformId, request.inputs, settings, tokenizer,
		));
	};
	return Object.freeze({
		transformIds: ASSISTANCE_OWNED_AUDIO_CUT_TRANSFORM_IDS_V1,
		run: run as AssistanceOwnedAudioCutTransformRegistryV1['run'],
	});
}

function dispatch(
	transformId: AssistanceOwnedAudioCutTransformIdV1,
	inputs: unknown,
	settings: AssistanceWorkflowSettingsV1,
	tokenizer: AssistanceTokenizerV1 | null,
): AssistanceOwnedAudioCutTransformResultV1 {
	switch (transformId) {
		case 'assemble-captions': return result(transformId, {
			captions: assembleOwnedCaptionsV1(inputs, asSettings(settings, 'transcribe-captions')),
		});
		case 'propose-cleanup': return result(transformId, {
			'cleanup-proposals': proposeOwnedCleanupV1(inputs,
				asSettings(settings, 'clean-filler-silence')),
		});
		case 'attribute-speakers': return result(transformId, {
			'attributed-transcript': attributeOwnedSpeakersV1(inputs,
				asSettings(settings, 'identify-speakers')),
		});
		case 'merge-reaction-ranges': return result(transformId, {
			'reaction-ranges': mergeOwnedReactionRangesV1(inputs,
				asSettings(settings, 'mark-reactions')),
		});
		case 'chunk-transcript': return result(transformId, {
			'text-chunks': chunkOwnedTranscriptV1(inputs,
				asSettings(settings, 'index-transcript'), tokenizer),
		});
		case 'publish-transcript-index': return result(transformId, {
			'transcript-index': publishOwnedTranscriptIndexV1(inputs,
				asSettings(settings, 'index-transcript')),
		});
		case 'propose-tempo-map': {
			const proposal = proposeOwnedTempoMapV1(inputs,
				asSettings(settings, 'detect-beats-tempo'));
			return result(transformId, {
				'beat-labels': proposal.beatLabels,
				'tempo-map-diff': proposal.tempoMapDiff,
			});
		}
		case 'normalize-cuts': return result(transformId, {
			'cut-proposals': normalizeOwnedCutsV1(inputs, asSettings(settings, 'mark-cuts')),
		});
	}
}

function result<Id extends AssistanceOwnedAudioCutTransformIdV1>(
	transformId: Id,
	outputs: AssistanceOwnedAudioCutTransformResultByIdV1[Id]['outputs'],
): AssistanceOwnedAudioCutTransformResultByIdV1[Id] {
	return Object.freeze({ schemaVersion: 1, transformId, outputs: Object.freeze(outputs) }) as unknown as
		AssistanceOwnedAudioCutTransformResultByIdV1[Id];
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
