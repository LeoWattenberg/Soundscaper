/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceOperation } from './operation.ts';

export const LOCAL_ASSISTANCE_INPUT_ROLES = Object.freeze([
	'audio', 'voice-activity', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);

export const LOCAL_ASSISTANCE_OUTPUT_ROLES = Object.freeze([
	'voice-activity', 'transcript', 'word-alignment', 'speaker-turns', 'enhanced-audio',
	'separated-audio', 'audio-tags', 'beat-grid', 'embeddings', 'recognized-text',
	'shot-boundaries', 'subject-tracks', 'saliency-map', 'editorial-proposal',
] as const);

export type LocalAssistanceInputRole = typeof LOCAL_ASSISTANCE_INPUT_ROLES[number];
export type LocalAssistanceOutputRole = typeof LOCAL_ASSISTANCE_OUTPUT_ROLES[number];

export interface LocalAssistanceOperationMediaContract {
	readonly inputs: readonly LocalAssistanceInputRole[];
	readonly required: readonly (readonly LocalAssistanceInputRole[])[];
	readonly outputs: readonly LocalAssistanceOutputRole[];
}

export type LocalAssistanceOperationMediaBoundary =
	| 'operation-request'
	| 'prepared-media'
	| 'bridge';

export const LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT = Object.freeze({
	'voice-activity-detection': operationMedia(['audio'], [['audio']], ['voice-activity']),
	'speech-recognition': operationMedia(['audio', 'voice-activity'], [['audio']], ['transcript']),
	'word-alignment': operationMedia(['audio', 'transcript'], [['audio'], ['transcript']], ['word-alignment']),
	'speaker-diarization': operationMedia(['audio'], [['audio']], ['speaker-turns']),
	'speech-enhancement': operationMedia(['audio'], [['audio']], ['enhanced-audio']),
	dereverberation: operationMedia(['audio'], [['audio']], ['enhanced-audio']),
	'source-separation': operationMedia(['audio'], [['audio']], ['separated-audio']),
	'audio-tagging': operationMedia(['audio'], [['audio']], ['audio-tags']),
	'beat-tracking': operationMedia(['audio'], [['audio']], ['beat-grid']),
	'text-embedding': operationMedia(['transcript', 'text'], [['transcript', 'text']], ['embeddings']),
	'image-text-embedding': operationMedia(['frame-pack', 'text'], [['frame-pack', 'text']], ['embeddings']),
	'optical-character-recognition': operationMedia(['frame-pack'], [['frame-pack']], ['recognized-text']),
	'shot-detection': operationMedia(['video', 'frame-pack'], [['video', 'frame-pack']], ['shot-boundaries']),
	'subject-detection': operationMedia(['frame-pack'], [['frame-pack']], ['subject-tracks']),
	'saliency-detection': operationMedia(['frame-pack'], [['frame-pack']], ['saliency-map']),
	'editorial-generation': operationMedia(['editorial-context'], [['editorial-context']], ['editorial-proposal']),
} satisfies Readonly<Record<AssistanceOperation, LocalAssistanceOperationMediaContract>>);

const BOUNDARY_INPUT_RESTRICTIONS = Object.freeze({
	'operation-request': Object.freeze({}),
	'prepared-media': Object.freeze({
		'speech-recognition': Object.freeze(['audio'] as const),
	}),
	bridge: Object.freeze({
		'speech-recognition': Object.freeze(['audio'] as const),
		'shot-detection': Object.freeze(['video'] as const),
	}),
} satisfies Readonly<Record<
	LocalAssistanceOperationMediaBoundary,
	Readonly<Partial<Record<AssistanceOperation, readonly LocalAssistanceInputRole[]>>>
>>);

/** Project the shared operation vocabulary onto one established protocol boundary. */
export function resolveLocalAssistanceOperationMediaContract(
	operation: AssistanceOperation,
	boundary: LocalAssistanceOperationMediaBoundary,
): LocalAssistanceOperationMediaContract {
	const contract = LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT[operation];
	const inputs = BOUNDARY_INPUT_RESTRICTIONS[boundary][operation];
	if (inputs === undefined) return contract;
	const admitted = new Set<LocalAssistanceInputRole>(inputs);
	const required = contract.required.map((group) => Object.freeze(
		group.filter((role) => admitted.has(role)),
	));
	if (required.some((group) => group.length === 0)) {
		throw new Error(`Local-assistance ${boundary} input restrictions are internally inconsistent.`);
	}
	return operationMedia(inputs, required, contract.outputs);
}

export const LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES = Object.freeze({
	audio: Object.freeze(['audio/wav', 'audio/x-wav', 'audio/flac']),
	'voice-activity': localAssistanceJsonMediaTypes('voice-activity'),
	video: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	transcript: Object.freeze(['application/json', 'application/vnd.soundscaper.transcript+json']),
	text: Object.freeze(['text/plain']),
	'editorial-context': Object.freeze([
		'application/json', 'application/vnd.soundscaper.editorial-context+json',
	]),
} satisfies Readonly<Record<LocalAssistanceInputRole, readonly string[]>>);

export const LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES = Object.freeze({
	'voice-activity': localAssistanceJsonMediaTypes('voice-activity'),
	transcript: localAssistanceJsonMediaTypes('transcript'),
	'word-alignment': localAssistanceJsonMediaTypes('word-alignment'),
	'speaker-turns': localAssistanceJsonMediaTypes('speaker-turns'),
	'enhanced-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'separated-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'audio-tags': localAssistanceJsonMediaTypes('audio-tags'),
	'beat-grid': localAssistanceJsonMediaTypes('beat-grid'),
	embeddings: Object.freeze(['application/vnd.soundscaper.embedding-matrix-v1']),
	'recognized-text': localAssistanceJsonMediaTypes('recognized-text'),
	'shot-boundaries': localAssistanceJsonMediaTypes('shot-boundaries'),
	'subject-tracks': localAssistanceJsonMediaTypes('subject-tracks'),
	'saliency-map': localAssistanceJsonMediaTypes('saliency-map'),
	'editorial-proposal': localAssistanceJsonMediaTypes('editorial-proposal'),
} satisfies Readonly<Record<LocalAssistanceOutputRole, readonly string[]>>);

export function localAssistanceJsonMediaTypes<const Role extends string>(
	role: Role,
): readonly ['application/json', `application/vnd.soundscaper.${Role}+json`] {
	return Object.freeze(['application/json', `application/vnd.soundscaper.${role}+json`] as const);
}

export function isLocalAssistanceMediaType(
	mediaTypes: readonly string[],
	value: unknown,
): value is string {
	return typeof value === 'string' && mediaTypes.some((mediaType) => mediaType === value);
}

function operationMedia(
	inputs: readonly LocalAssistanceInputRole[],
	required: readonly (readonly LocalAssistanceInputRole[])[],
	outputs: readonly LocalAssistanceOutputRole[],
): LocalAssistanceOperationMediaContract {
	return Object.freeze({
		inputs: Object.freeze([...inputs]),
		required: Object.freeze(required.map((roles) => Object.freeze([...roles]))),
		outputs: Object.freeze([...outputs]),
	});
}
