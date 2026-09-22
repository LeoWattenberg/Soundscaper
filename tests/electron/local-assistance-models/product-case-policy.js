/* SPDX-License-Identifier: AGPL-3.0-only */

const PRODUCT_OPERATIONS = Object.freeze({
	framescaper: new Set([
		'audio-tagging',
		'beat-tracking',
		'dereverberation',
		'editorial-generation',
		'image-text-embedding',
		'optical-character-recognition',
		'saliency-detection',
		'shot-detection',
		'source-separation',
		'speaker-diarization',
		'speech-enhancement',
		'speech-recognition',
		'text-to-speech',
		'subject-detection',
		'text-embedding',
		'voice-activity-detection',
		'word-alignment',
	]),
	soundscaper: new Set([
		'audio-tagging',
		'beat-tracking',
		'dereverberation',
		'source-separation',
		'speaker-diarization',
		'speech-enhancement',
		'speech-recognition',
		'text-to-speech',
		'text-embedding',
		'voice-activity-detection',
		'word-alignment',
	]),
});

export function localAssistanceCaseRunsInProduct(productId, operation) {
	if (!Object.hasOwn(PRODUCT_OPERATIONS, productId)) {
		throw new TypeError('The local-assistance product is unsupported.');
	}
	return typeof operation === 'string' && PRODUCT_OPERATIONS[productId].has(operation);
}
