/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** @param {string} repositoryRoot @param {'baseline' | 'successor'} line @param {string} baseline */
export function framescaperBuildApplicationVersion(repositoryRoot, line, baseline) {
	if (line === 'baseline') return baseline;
	if (line !== 'successor') throw new Error('Unknown Framescaper development line.');
	const register = JSON.parse(readFileSync(join(repositoryRoot, 'config/framescaper-successor-line.json'), 'utf8'));
	if (register.schemaVersion !== 1 || register.productId !== 'framescaper' || register.line !== 'successor'
		|| register.projectSchemaVersion !== 2 || register.databaseName !== 'kw-media-framescaper-editor-v2'
		|| register.releaseEligible !== false || !/^1\.1\.0-dev\.[1-9][0-9]*$/u.test(register.applicationVersion)) {
		throw new Error('Framescaper successor release identity is invalid.');
	}
	return String(register.applicationVersion);
}
