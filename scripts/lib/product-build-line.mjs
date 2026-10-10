/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

/**
 * An explicit build input keeps the frozen Framescaper line the default.
 * @param {string} productId
 * @param {string | undefined} value
 * @returns {'baseline' | 'successor'}
 */
export function resolveFramescaperBuildLine(productId, value) {
	const line = value === undefined || value === '' ? 'baseline' : value;
	if (line !== 'baseline' && line !== 'successor') {
		throw new Error('SCAPE_FRAMESCAPER_LINE must be baseline or successor.');
	}
	if (line === 'successor' && productId !== 'framescaper') {
		throw new Error('The successor line is only available to Framescaper builds.');
	}
	return line;
}
