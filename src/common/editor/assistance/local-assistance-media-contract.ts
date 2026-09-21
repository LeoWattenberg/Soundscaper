/* SPDX-License-Identifier: AGPL-3.0-only */

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

export const LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES = Object.freeze({
	audio: Object.freeze(['audio/wav', 'audio/x-wav', 'audio/flac']),
	'voice-activity': jsonTypes('voice-activity'),
	video: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	transcript: Object.freeze(['application/json', 'application/vnd.soundscaper.transcript+json']),
	text: Object.freeze(['text/plain']),
	'editorial-context': Object.freeze([
		'application/json', 'application/vnd.soundscaper.editorial-context+json',
	]),
} satisfies Readonly<Record<LocalAssistanceInputRole, readonly string[]>>);

export const LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES = Object.freeze({
	'voice-activity': jsonTypes('voice-activity'),
	transcript: jsonTypes('transcript'),
	'word-alignment': jsonTypes('word-alignment'),
	'speaker-turns': jsonTypes('speaker-turns'),
	'enhanced-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'separated-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'audio-tags': jsonTypes('audio-tags'),
	'beat-grid': jsonTypes('beat-grid'),
	embeddings: Object.freeze(['application/vnd.soundscaper.embedding-matrix-v1']),
	'recognized-text': jsonTypes('recognized-text'),
	'shot-boundaries': jsonTypes('shot-boundaries'),
	'subject-tracks': jsonTypes('subject-tracks'),
	'saliency-map': jsonTypes('saliency-map'),
	'editorial-proposal': jsonTypes('editorial-proposal'),
} satisfies Readonly<Record<LocalAssistanceOutputRole, readonly string[]>>);

function jsonTypes(role: string): readonly string[] {
	return Object.freeze(['application/json', `application/vnd.soundscaper.${role}+json`]);
}
