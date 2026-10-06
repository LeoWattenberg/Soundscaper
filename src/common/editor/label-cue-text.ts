/* SPDX-License-Identifier: AGPL-3.0-only */

/** Labels are plain text; WebVTT cue payloads give punctuation markup meaning. */
export function encodeWebVttLabelText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const WEBVTT_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
	amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f',
});

/** Decode the six character references the WebVTT text reader recognizes once. */
export function decodeWebVttLabelText(value: string): string {
	return value.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/gu, (reference: string, name: string) => (
		WEBVTT_ENTITIES[name] ?? reference
	));
}
