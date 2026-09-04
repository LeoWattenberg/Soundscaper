/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The one reading of the maintainability size policy.
 *
 * `scripts/check-file-size.mjs` enforces it over the whole tree at gate time, and the
 * PostToolUse hook in `.claude/settings.json` reports it for a single file the moment that
 * file is edited. Both answer the same question — how much room is left before this file
 * has to be split — so both ask it here rather than reimplementing the bands.
 */

const BROWSER_SPEC_PATTERN = /^tests\/browser\/.*\.spec\.[cm]?[jt]sx?$/u;

/** Read and validate `config/maintainability-allowlist.json`. */
export function loadMaintainabilityConfig(root) {
	const config = JSON.parse(readFileSync(join(root, 'config', 'maintainability-allowlist.json'), 'utf8'));
	const positiveInteger = (value) => Number.isSafeInteger(value) && value >= 1;
	if (config.schemaVersion !== 1
		|| !positiveInteger(config.defaultMaxLines)
		|| !positiveInteger(config.browserSpecMaxLines)
		|| !positiveInteger(config.warnLines)
		|| config.warnLines > config.defaultMaxLines
		|| !config.allow
		|| typeof config.allow !== 'object'
		|| Array.isArray(config.allow)) {
		throw new Error('Unsupported maintainability allowlist schema.');
	}
	return config;
}

/** The line ceiling that applies to one repository path. */
export function ceilingFor(repositoryPath, config) {
	return BROWSER_SPEC_PATTERN.test(repositoryPath) ? config.browserSpecMaxLines : config.defaultMaxLines;
}

/**
 * Classify one file against the policy.
 *
 * Only growth fails. A file that has shrunk below its allowlist ratchet reports `slack`, a
 * note the gate prints and `--tighten` acts on, because failing a shrink would mean an
 * agent that split code out of an oversized file had to edit the allowlist before its work
 * could pass — punishing exactly the change the ceiling exists to encourage.
 */
export function assessFile(repositoryPath, lines, config) {
	const ceiling = ceilingFor(repositoryPath, config);
	const exception = config.allow[repositoryPath];
	if (exception) {
		if (!Number.isSafeInteger(exception.maxLines) || !String(exception.reason || '').trim()) {
			return { status: 'invalid-exception', lines, ceiling, ratchet: exception.maxLines };
		}
		if (lines > exception.maxLines) {
			return { status: 'over-ratchet', lines, ceiling, ratchet: exception.maxLines };
		}
		if (lines <= ceiling) return { status: 'exception-obsolete', lines, ceiling, ratchet: exception.maxLines };
		if (lines < exception.maxLines) return { status: 'slack', lines, ceiling, ratchet: exception.maxLines };
		return { status: 'at-ratchet', lines, ceiling, ratchet: exception.maxLines };
	}
	if (lines > ceiling) return { status: 'over-ceiling', lines, ceiling, ratchet: null };
	if (lines >= config.warnLines) return { status: 'near-ceiling', lines, ceiling, ratchet: null };
	return { status: 'ok', lines, ceiling, ratchet: null };
}

/** The message for an assessment, or null when the file needs no comment. */
export function describeAssessment(repositoryPath, assessment) {
	const { status, lines, ceiling, ratchet } = assessment;
	switch (status) {
		case 'invalid-exception':
			return `${repositoryPath}: allowlist entries require maxLines and a reason.`;
		case 'over-ratchet':
			return `${repositoryPath}: ${lines} lines exceeds its ratchet of ${ratchet}; extract code or review the allowlist explicitly.`;
		case 'over-ceiling':
			return `${repositoryPath}: ${lines} lines exceeds the ${ceiling}-line limit.`;
		case 'exception-obsolete':
			return `${repositoryPath}: now ${lines} lines, back under the ${ceiling}-line limit; run check:size:tighten to drop its size exception.`;
		case 'slack':
			return `${repositoryPath}: now ${lines} lines against a ratchet of ${ratchet}; run check:size:tighten to claim the ${ratchet - lines} recovered lines.`;
		case 'near-ceiling':
			return lines === ceiling
				? `${repositoryPath}: ${lines} lines, exactly on the ${ceiling}-line limit.`
				: `${repositoryPath}: ${lines} lines, ${ceiling - lines} below the ${ceiling}-line limit.`;
		default:
			return null;
	}
}

/** Statuses that fail the gate: every one of them is a file that grew past its budget. */
export const FAILING_STATUSES = Object.freeze(['invalid-exception', 'over-ratchet', 'over-ceiling']);
