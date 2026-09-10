/* SPDX-License-Identifier: AGPL-3.0-only */

// Legacy controller values are narrowed as the owning import service migrates.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyPort = any;

const BEXT_CODEC_WARNING_CODES = new Set([
	'invalid-ascii', 'invalid-chunk-id', 'invalid-date', 'invalid-line-ending',
	'invalid-loudness', 'invalid-padding', 'invalid-time', 'nonzero-reserved',
	'payload-too-large', 'truncated-chunk', 'truncated-payload',
	'unterminated-coding-history', 'unsupported-version',
]);

export function createImportResultWithWarnings(copy: LegacyPort) {
	return function importResultWithWarnings(result: LegacyPort, warnings: readonly LegacyPort[]) {
		const interchangeMessages = importInterchangeMessages(result);
		if (!warnings.length && !interchangeMessages.length) return result;
		const messages = [...new Set([...warnings.map((warning) => {
			if (typeof warning === 'string') return warning;
			if (warning?.code === 'bext-time-reference-conversion' || warning?.code === 'bext-spot-out-of-range') {
				return warning.message;
			}
			if (isBextMetadataWarning(warning)) {
				return copy.bextMetadataImportWarning || warning.message;
			}
			if (typeof warning?.message === 'string') return warning.message;
			return String(warning?.code || 'WAV metadata warning.');
		}), ...interchangeMessages].filter(Boolean))];
		return Object.freeze({
			...result,
			...(warnings.length ? { metadataWarnings: Object.freeze([...warnings]) } : {}),
			...(messages.length ? { notice: messages.join(' ') } : {}),
		});
	};
}

// The interchange report names every cue the import converted, clipped, or
// dropped; without folding it into the notice those losses stay invisible.
function importInterchangeMessages(result: LegacyPort): string[] {
	const items = result?.timelineAnnotationInterchangeReport?.items;
	if (!Array.isArray(items)) return [];
	return items
		.filter((item: LegacyPort) => item?.disposition !== 'preserved')
		.map((item: LegacyPort) => (typeof item?.message === 'string' ? item.message : ''))
		.filter(Boolean);
}

function isBextMetadataWarning(warning: LegacyPort) {
	const code = typeof warning?.code === 'string' ? warning.code : '';
	return code.startsWith('bext-') || BEXT_CODEC_WARNING_CODES.has(code);
}
