/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Closed, renderer-independent workflow recipes for local assistance.
 *
 * A workflow request carries stage IDs only. The operation, dependency, claim
 * slots, and model slots below are therefore derived by trusted code instead
 * of being supplied by the renderer.
 */

import {
	ASSISTANCE_OPERATIONS,
	type AssistanceOperation,
} from './operation.ts';

export const ASSISTANCE_GUIDED_WORKFLOW_IDS = Object.freeze([
	'transcribe-captions',
	'clean-filler-silence',
	'identify-speakers',
	'enhance-dialogue',
	'separate-dialogue-music-effects',
	'mark-reactions',
	'index-transcript',
	'detect-beats-tempo',
	'mark-cuts',
	'index-video',
	'reframe',
	'make-highlights',
	'generate-editorial-text',
] as const);

export type AssistanceGuidedWorkflowId = (typeof ASSISTANCE_GUIDED_WORKFLOW_IDS)[number];
export type AssistanceAdvancedWorkflowId = `advanced:${AssistanceOperation}`;

export const ADVANCED_ASSISTANCE_WORKFLOW_IDS = Object.freeze(
	ASSISTANCE_OPERATIONS.map((operation) => `advanced:${operation}` as AssistanceAdvancedWorkflowId),
);

export const ASSISTANCE_WORKFLOW_IDS = Object.freeze([
	...ASSISTANCE_GUIDED_WORKFLOW_IDS,
	...ADVANCED_ASSISTANCE_WORKFLOW_IDS,
]);

export type AssistanceWorkflowId = AssistanceGuidedWorkflowId | AssistanceAdvancedWorkflowId;

export interface AssistanceWorkflowSlotSpec {
	readonly slotId: string;
	readonly required: boolean;
}

export interface AssistanceWorkflowStageSpec {
	readonly stageId: string;
	readonly operation: AssistanceOperation | null;
	readonly required: boolean;
	readonly after: readonly string[];
	readonly inputSlots: readonly AssistanceWorkflowSlotSpec[];
	readonly outputSlots: readonly AssistanceWorkflowSlotSpec[];
	readonly modelSlots: readonly AssistanceWorkflowSlotSpec[];
}

interface StageDeclaration {
	readonly stageId: string;
	readonly operation: AssistanceOperation | null;
	readonly required?: boolean;
	readonly after?: readonly string[];
	readonly inputs: readonly string[];
	readonly optionalInputs?: readonly string[];
	readonly outputs: readonly string[];
	readonly optionalOutputs?: readonly string[];
	readonly models?: readonly string[];
	readonly optionalModels?: readonly string[];
}

const GUIDED_GRAPHS = Object.freeze({
	'transcribe-captions': graph([
		stage({ stageId: 'detect-speech', operation: 'voice-activity-detection',
			inputs: ['audio'], outputs: ['voice-activity'], models: ['vad'] }),
		stage({ stageId: 'recognize-speech', operation: 'speech-recognition', after: ['detect-speech'],
			inputs: ['audio', 'voice-activity'], outputs: ['transcript'], models: ['speech-recognizer'] }),
		stage({ stageId: 'align-words', operation: 'word-alignment', required: false,
			after: ['recognize-speech'], inputs: ['audio', 'transcript'], outputs: ['word-alignment'],
			models: ['alignment'] }),
		stage({ stageId: 'assemble-captions', operation: null, after: ['recognize-speech'],
			inputs: ['transcript'], optionalInputs: ['word-alignment'], outputs: ['captions'] }),
	]),
	'clean-filler-silence': graph([
		stage({ stageId: 'detect-speech', operation: 'voice-activity-detection',
			inputs: ['audio'], outputs: ['voice-activity'], models: ['vad'] }),
		stage({ stageId: 'recognize-speech', operation: 'speech-recognition', required: false,
			after: ['detect-speech'], inputs: ['audio', 'voice-activity'], outputs: ['transcript'],
			models: ['speech-recognizer'] }),
		stage({ stageId: 'propose-cleanup', operation: null, after: ['detect-speech'],
			inputs: ['voice-activity'], optionalInputs: ['transcript'], outputs: ['cleanup-proposals'] }),
	]),
	'identify-speakers': graph([
		stage({ stageId: 'diarize-speakers', operation: 'speaker-diarization',
			inputs: ['audio'], outputs: ['speaker-turns'], models: ['diarizer', 'speaker-embedding'] }),
		stage({ stageId: 'attribute-speakers', operation: null, after: ['diarize-speakers'],
			inputs: ['transcript', 'speaker-turns'], outputs: ['attributed-transcript'] }),
	]),
	'enhance-dialogue': graph([
		stage({ stageId: 'enhance-dialogue', operation: 'speech-enhancement',
			inputs: ['audio'], outputs: ['enhanced-audio'], models: ['enhancer'] }),
	]),
	'separate-dialogue-music-effects': graph([
		stage({ stageId: 'separate-sources', operation: 'source-separation',
			inputs: ['audio'], outputs: ['dialogue', 'music', 'effects'], models: ['separator'] }),
	]),
	'mark-reactions': graph([
		stage({ stageId: 'tag-reactions', operation: 'audio-tagging',
			inputs: ['audio'], outputs: ['audio-tags'], models: ['audio-tagger'] }),
		stage({ stageId: 'merge-reaction-ranges', operation: null, after: ['tag-reactions'],
			inputs: ['audio-tags'], outputs: ['reaction-ranges'] }),
	]),
	'index-transcript': graph([
		stage({ stageId: 'chunk-transcript', operation: null,
			inputs: ['transcript'], outputs: ['text-chunks'] }),
		stage({ stageId: 'embed-transcript', operation: 'text-embedding', after: ['chunk-transcript'],
			inputs: ['text-chunks'], outputs: ['embeddings'], models: ['text-embedder'] }),
		stage({ stageId: 'publish-transcript-index', operation: null, after: ['embed-transcript'],
			inputs: ['text-chunks', 'embeddings'], outputs: ['transcript-index'] }),
	]),
	'detect-beats-tempo': graph([
		stage({ stageId: 'track-beats', operation: 'beat-tracking',
			inputs: ['audio'], outputs: ['beat-grid'], models: ['beat-tracker'] }),
		stage({ stageId: 'propose-tempo-map', operation: null, after: ['track-beats'],
			inputs: ['beat-grid'], outputs: ['beat-labels', 'tempo-map-diff'] }),
	]),
	'mark-cuts': graph([
		stage({ stageId: 'detect-shots', operation: 'shot-detection',
			inputs: [], optionalInputs: ['video', 'frame-pack'], outputs: ['shot-boundaries'],
			optionalModels: ['accurate-shot-detector'] }),
		stage({ stageId: 'normalize-cuts', operation: null, after: ['detect-shots'],
			inputs: ['shot-boundaries'], outputs: ['cut-proposals'] }),
	]),
	'index-video': graph([
		stage({ stageId: 'detect-shots', operation: 'shot-detection',
			inputs: [], optionalInputs: ['video', 'frame-pack'], outputs: ['shot-boundaries'],
			optionalModels: ['accurate-shot-detector'] }),
		stage({ stageId: 'sample-shot-frames', operation: null, after: ['detect-shots'],
			inputs: ['video', 'video-authority', 'shot-boundaries'], outputs: ['frame-pack'] }),
		stage({ stageId: 'embed-visuals', operation: 'image-text-embedding', after: ['sample-shot-frames'],
			inputs: ['frame-pack'], outputs: ['visual-embeddings'], models: ['visual-embedder'] }),
		stage({ stageId: 'recognize-text', operation: 'optical-character-recognition', required: false,
			after: ['sample-shot-frames'], inputs: ['frame-pack'], outputs: ['recognized-text'],
			models: ['text-detector', 'text-recognizer'] }),
		stage({ stageId: 'publish-video-index', operation: null,
			after: ['embed-visuals'],
			inputs: ['visual-embeddings'], optionalInputs: ['recognized-text'], outputs: ['video-index'] }),
	]),
	'reframe': graph([
		stage({ stageId: 'detect-subjects', operation: 'subject-detection',
			inputs: ['frame-pack'], outputs: ['subject-tracks'], models: ['face-detector', 'object-detector'] }),
		stage({ stageId: 'detect-saliency', operation: 'saliency-detection',
			inputs: ['frame-pack'], outputs: ['saliency-map'], models: ['saliency-detector'] }),
		stage({ stageId: 'track-subjects', operation: null, after: ['detect-subjects'],
			inputs: ['subject-tracks'], outputs: ['tracked-subjects'] }),
		stage({ stageId: 'plan-crops', operation: null, after: ['track-subjects', 'detect-saliency'],
			inputs: ['tracked-subjects', 'saliency-map'], outputs: ['reframe-path'] }),
	]),
	'make-highlights': graph([
		stage({ stageId: 'detect-highlight-shots', operation: 'shot-detection',
			inputs: ['video'], outputs: ['shot-boundaries'] }),
		stage({ stageId: 'tag-highlight-reactions', operation: 'audio-tagging', required: false,
			inputs: ['audio'], outputs: ['audio-tags'], models: ['audio-tagger'] }),
		stage({ stageId: 'gather-signals', operation: null, after: ['detect-highlight-shots'],
			inputs: ['video'], optionalInputs: ['audio', 'transcript', 'shot-boundaries', 'audio-tags',
				'reaction-ranges', 'embeddings'], outputs: ['highlight-signals'] }),
		stage({ stageId: 'rank-highlights', operation: null, after: ['gather-signals'],
			inputs: ['highlight-signals'], outputs: ['highlight-candidates'] }),
		stage({ stageId: 'rerank-editorial', operation: 'editorial-generation', required: false,
			after: ['rank-highlights'], inputs: ['highlight-candidates'], outputs: ['editorial-proposal'],
			models: ['editorial-generator'] }),
		stage({ stageId: 'assemble-highlights', operation: null, after: ['rank-highlights'],
			inputs: ['highlight-candidates'], optionalInputs: ['editorial-proposal'],
			outputs: ['highlight-proposals'] }),
	]),
	'generate-editorial-text': graph([
		stage({ stageId: 'generate-editorial-text', operation: 'editorial-generation',
			inputs: ['editorial-context'], outputs: ['editorial-proposal'], models: ['editorial-generator'] }),
	]),
} satisfies Readonly<Record<AssistanceGuidedWorkflowId, readonly AssistanceWorkflowStageSpec[]>>);

const ADVANCED_DECLARATIONS = Object.freeze({
	'voice-activity-detection': advanced(['audio'], ['voice-activity']),
	'speech-recognition': advanced(['audio'], ['transcript'], {
		optionalInputs: ['voice-activity'],
	}),
	'word-alignment': advanced(['audio', 'transcript'], ['word-alignment']),
	'speaker-diarization': advanced(['audio'], ['speaker-turns'], {
		models: ['diarizer', 'speaker-embedding'],
	}),
	'speech-enhancement': advanced(['audio'], ['enhanced-audio']),
	'source-separation': advanced(['audio'], ['dialogue', 'music', 'effects']),
	'audio-tagging': advanced(['audio'], ['audio-tags']),
	'beat-tracking': advanced(['audio'], ['beat-grid']),
	'text-embedding': advanced([], ['embeddings'], {
		optionalInputs: ['transcript', 'text'],
	}),
	'image-text-embedding': advanced([], ['embeddings'], {
		optionalInputs: ['frame-pack', 'text'],
	}),
	'optical-character-recognition': advanced(['frame-pack'], ['recognized-text']),
	'shot-detection': advanced([], ['shot-boundaries'], {
		optionalInputs: ['video', 'frame-pack'], optionalModels: ['model'],
	}),
	'subject-detection': advanced(['frame-pack'], ['subject-tracks'], {
		models: ['face-detector', 'object-detector'],
	}),
	'saliency-detection': advanced(['frame-pack'], ['saliency-map']),
	'editorial-generation': advanced(['editorial-context'], ['editorial-proposal']),
} satisfies Readonly<Record<AssistanceOperation, Omit<StageDeclaration,
	'stageId' | 'operation'>>>);

const ADVANCED_GRAPHS = new Map<AssistanceAdvancedWorkflowId, readonly AssistanceWorkflowStageSpec[]>(
	ASSISTANCE_OPERATIONS.map((operation) => [
		`advanced:${operation}` as AssistanceAdvancedWorkflowId,
		graph([stage({
			stageId: `run-${operation}`,
			operation,
			...ADVANCED_DECLARATIONS[operation],
		})]),
	]),
);

const WORKFLOW_ID_SET = new Set<unknown>(ASSISTANCE_WORKFLOW_IDS);

export function normalizeAssistanceWorkflowId(value: unknown): AssistanceWorkflowId {
	if (!WORKFLOW_ID_SET.has(value)) throw new TypeError('The assistance workflow is unsupported.');
	return value as AssistanceWorkflowId;
}

/** Return the immutable graph owned by one closed workflow ID. */
export function assistanceWorkflowStageGraph(
	workflowIdValue: unknown,
): readonly AssistanceWorkflowStageSpec[] {
	const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
	if (workflowId.startsWith('advanced:')) {
		return ADVANCED_GRAPHS.get(workflowId as AssistanceAdvancedWorkflowId)!;
	}
	return GUIDED_GRAPHS[workflowId as AssistanceGuidedWorkflowId];
}

function stage(declaration: StageDeclaration): AssistanceWorkflowStageSpec {
	return Object.freeze({
		stageId: declaration.stageId,
		operation: declaration.operation,
		required: declaration.required ?? true,
		after: Object.freeze([...(declaration.after ?? [])]),
		inputSlots: slots(declaration.inputs, declaration.optionalInputs),
		outputSlots: slots(declaration.outputs, declaration.optionalOutputs),
		modelSlots: slots(declaration.models ?? [], declaration.optionalModels),
	});
}

function advanced(
	inputs: readonly string[],
	outputs: readonly string[],
	options: Readonly<{
		optionalInputs?: readonly string[];
		models?: readonly string[];
		optionalModels?: readonly string[];
	}> = {},
): Omit<StageDeclaration, 'stageId' | 'operation'> {
	return Object.freeze({ inputs: Object.freeze([...inputs]), outputs: Object.freeze([...outputs]),
		optionalInputs: Object.freeze([...(options.optionalInputs ?? [])]),
		models: Object.freeze([...(options.models ?? (options.optionalModels ? [] : ['model']))]),
		optionalModels: Object.freeze([...(options.optionalModels ?? [])]) });
}

function slots(required: readonly string[], optional: readonly string[] = []): readonly AssistanceWorkflowSlotSpec[] {
	return Object.freeze([
		...required.map((slotId) => Object.freeze({ slotId, required: true })),
		...optional.map((slotId) => Object.freeze({ slotId, required: false })),
	]);
}

function graph(stages: readonly AssistanceWorkflowStageSpec[]): readonly AssistanceWorkflowStageSpec[] {
	const ids = new Set<string>();
	for (const item of stages) {
		if (ids.has(item.stageId)) throw new Error(`Duplicate assistance workflow stage ${item.stageId}.`);
		for (const dependency of item.after) {
			if (!ids.has(dependency)) throw new Error(`Assistance workflow stage ${item.stageId} has a forward dependency.`);
		}
		ids.add(item.stageId);
	}
	return Object.freeze([...stages]);
}
