/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * The one reading of the maintainability size policy.
 *
 * `scripts/check-file-size.mjs` enforces it over the whole tree at gate time, and the
 * PostToolUse hook in `.claude/settings.json` reports it for a single file the moment that
 * file is edited. Both answer the same question — whether this file must be split before
 * it grows — so both ask it here rather than reimplementing the bands and ratchets.
 */

const BROWSER_SPEC_PATTERN = /^tests\/browser\/.*\.spec\.[cm]?[jt]sx?$/u;

/** Read and validate `config/maintainability-allowlist.json`. */
export function loadMaintainabilityConfig(root) {
	return validateMaintainabilityConfig(JSON.parse(
		readFileSync(join(root, 'config', 'maintainability-allowlist.json'), 'utf8'),
	));
}

/** Validate one parsed maintainability configuration. */
export function validateMaintainabilityConfig(config) {
	const positiveInteger = (value) => Number.isSafeInteger(value) && value >= 1;
	if (config.schemaVersion !== 2
		|| !positiveInteger(config.defaultMaxLines)
		|| !positiveInteger(config.browserSpecMaxLines)
		|| !positiveInteger(config.warnLines)
		|| config.warnLines >= config.defaultMaxLines
		|| config.warnLines >= config.browserSpecMaxLines
		|| !config.warningBandRatchets
		|| typeof config.warningBandRatchets !== 'object'
		|| Array.isArray(config.warningBandRatchets)
		|| !config.allow
		|| typeof config.allow !== 'object'
		|| Array.isArray(config.allow)) {
		throw new Error('Unsupported maintainability allowlist schema.');
	}
	for (const [repositoryPath, exception] of Object.entries(config.allow)) {
		if (!canonicalRepositoryPath(repositoryPath)
			|| !exception
			|| typeof exception !== 'object'
			|| Array.isArray(exception)
			|| !positiveInteger(exception.maxLines)
			|| exception.maxLines <= ceilingFor(repositoryPath, config)
			|| !String(exception.reason || '').trim()) {
			throw new Error(`Invalid size exception for ${repositoryPath}.`);
		}
	}
	for (const [repositoryPath, maxLines] of Object.entries(config.warningBandRatchets)) {
		if (!canonicalRepositoryPath(repositoryPath)
			|| !positiveInteger(maxLines)
			|| maxLines < config.warnLines
			|| maxLines > ceilingFor(repositoryPath, config)
			|| Object.hasOwn(config.allow, repositoryPath)) {
			throw new Error(`Invalid warning-band ratchet for ${repositoryPath}.`);
		}
	}
	return config;
}

/** Reject policy changes that would bless growth relative to the trusted base revision. */
export function compareMaintainabilityConfigs(
	config,
	baseline,
	previousPathByCurrent = new Map(),
	currentLineCounts = new Map(),
) {
	const findings = [];
	if (config.defaultMaxLines > baseline.defaultMaxLines) {
		findings.push(`Default maintainability ceiling increased from ${baseline.defaultMaxLines} to ${config.defaultMaxLines}.`);
	}
	if (config.browserSpecMaxLines > baseline.browserSpecMaxLines) {
		findings.push(`Browser-spec ceiling increased from ${baseline.browserSpecMaxLines} to ${config.browserSpecMaxLines}.`);
	}
	if (config.warnLines > baseline.warnLines) {
		findings.push(`Maintainability warning threshold increased from ${baseline.warnLines} to ${config.warnLines}.`);
	}
	for (const [repositoryPath, exception] of Object.entries(config.allow)) {
		const previousPath = previousPathByCurrent.get(repositoryPath) ?? repositoryPath;
		const previous = baseline.allow?.[previousPath];
		if (!previous) {
			findings.push(`${repositoryPath}: new size exception cannot bless file growth.`);
		} else if (exception.maxLines > previous.maxLines) {
			findings.push(`${repositoryPath}: size exception was raised from ${previous.maxLines} to ${exception.maxLines}.`);
		}
	}
	if (baseline.schemaVersion !== 2) {
		for (const [repositoryPath, maxLines] of Object.entries(config.warningBandRatchets)) {
			if (currentLineCounts.get(repositoryPath) !== maxLines) {
				findings.push(`${repositoryPath}: initial warning-band ratchet must equal its current line count.`);
			}
		}
		return findings;
	}
	for (const [repositoryPath, maxLines] of Object.entries(config.warningBandRatchets)) {
		const previousPath = previousPathByCurrent.get(repositoryPath) ?? repositoryPath;
		const previousRatchet = baseline.warningBandRatchets?.[previousPath];
		const previousException = baseline.allow?.[previousPath];
		const previousMax = previousRatchet ?? previousException?.maxLines;
		if (previousMax === undefined) {
			findings.push(`${repositoryPath}: new warning-band ratchet cannot bless file growth.`);
		} else if (maxLines > previousMax) {
			findings.push(`${repositoryPath}: warning-band ratchet was raised from ${previousMax} to ${maxLines}.`);
		}
	}
	return findings;
}

/** Describe growth that crossed or remained inside the effective warning band. */
export function describeMaintainedFileGrowth(
	repositoryPath,
	lines,
	baselineLines,
	warningThreshold,
) {
	if (lines < warningThreshold) return null;
	if (baselineLines === null) {
		return `${repositoryPath}: ${lines} warning-band lines have no predecessor at the maintainability base revision.`;
	}
	if (lines > baselineLines) {
		return `${repositoryPath}: grew from ${baselineLines} to ${lines} lines against the maintainability base revision.`;
	}
	return null;
}

/** Return a config with observed reductions applied to both kinds of size ratchet. */
export function tightenMaintainabilityConfig(config, allowTightenings, warningBandTightenings) {
	const updated = {
		...config,
		warningBandRatchets: { ...config.warningBandRatchets },
		allow: { ...config.allow },
	};
	for (const [repositoryPath, maxLines] of allowTightenings) {
		if (maxLines === null) delete updated.allow[repositoryPath];
		else updated.allow[repositoryPath] = { ...updated.allow[repositoryPath], maxLines };
	}
	for (const [repositoryPath, maxLines] of warningBandTightenings) {
		if (maxLines === null) delete updated.warningBandRatchets[repositoryPath];
		else updated.warningBandRatchets[repositoryPath] = maxLines;
	}
	updated.warningBandRatchets = sortedRecord(updated.warningBandRatchets);
	updated.allow = sortedRecord(updated.allow);
	return updated;
}

/** Plan the config entries one non-failing assessment can tighten. */
export function planMaintainabilityTightening(assessment, config) {
	switch (assessment.status) {
		case 'exception-obsolete':
			return assessment.lines >= config.warnLines
				? { allow: null, warningBand: assessment.lines }
				: { allow: null };
		case 'slack':
			return { allow: assessment.lines };
		case 'warning-ratchet-obsolete':
			return { warningBand: null };
		case 'warning-ratchet-slack':
			return { warningBand: assessment.lines };
		default:
			return {};
	}
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
		if (lines <= ceiling) {
			return {
				status: 'exception-obsolete',
				lines,
				ceiling,
				ratchet: exception.maxLines,
				warningThreshold: config.warnLines,
			};
		}
		if (lines < exception.maxLines) return { status: 'slack', lines, ceiling, ratchet: exception.maxLines };
		return { status: 'at-ratchet', lines, ceiling, ratchet: exception.maxLines };
	}
	const warningRatchet = config.warningBandRatchets[repositoryPath];
	if (warningRatchet !== undefined) {
		if (lines > warningRatchet) {
			return { status: 'over-warning-ratchet', lines, ceiling, ratchet: warningRatchet };
		}
		if (lines < config.warnLines) {
			return {
				status: 'warning-ratchet-obsolete',
				lines,
				ceiling,
				ratchet: warningRatchet,
				warningThreshold: config.warnLines,
			};
		}
		if (lines < warningRatchet) {
			return { status: 'warning-ratchet-slack', lines, ceiling, ratchet: warningRatchet };
		}
		return { status: 'at-warning-ratchet', lines, ceiling, ratchet: warningRatchet };
	}
	if (lines > ceiling) return { status: 'over-ceiling', lines, ceiling, ratchet: null };
	if (lines >= config.warnLines) {
		return { status: 'unratcheted-warning-band', lines, ceiling, ratchet: null };
	}
	return { status: 'ok', lines, ceiling, ratchet: null };
}

/** The message for an assessment, or null when the file needs no comment. */
export function describeAssessment(repositoryPath, assessment) {
	const { status, lines, ceiling, ratchet, warningThreshold } = assessment;
	switch (status) {
		case 'invalid-exception':
			return `${repositoryPath}: allowlist entries require maxLines and a reason.`;
		case 'over-ratchet':
			return `${repositoryPath}: ${lines} lines exceeds its ratchet of ${ratchet}; extract code or review the allowlist explicitly.`;
		case 'over-warning-ratchet':
			return `${repositoryPath}: ${lines} lines exceeds its warning-band ratchet of ${ratchet}; extract a focused module.`;
		case 'over-ceiling':
			return `${repositoryPath}: ${lines} lines exceeds the ${ceiling}-line limit.`;
		case 'unratcheted-warning-band':
			return `${repositoryPath}: ${lines} lines entered the warning band without a checked-in baseline; extract a focused module.`;
		case 'exception-obsolete':
			return lines >= warningThreshold
				? `${repositoryPath}: now ${lines} lines, back under the ${ceiling}-line limit; run check:size:tighten to replace its size exception with a warning-band ratchet.`
				: `${repositoryPath}: now ${lines} lines, back under the ${ceiling}-line limit; run check:size:tighten to drop its size exception.`;
		case 'slack':
			return `${repositoryPath}: now ${lines} lines against a ratchet of ${ratchet}; run check:size:tighten to claim the ${ratchet - lines} recovered lines.`;
		case 'warning-ratchet-obsolete':
			return `${repositoryPath}: now ${lines} lines, below the ${warningThreshold}-line warning band; run check:size:tighten to drop its warning-band ratchet.`;
		case 'warning-ratchet-slack':
			return `${repositoryPath}: now ${lines} lines against a warning-band ratchet of ${ratchet}; run check:size:tighten to claim the ${ratchet - lines} recovered lines.`;
		case 'at-warning-ratchet':
			return `${repositoryPath}: ${lines} lines at its warning-band ratchet; any growth fails.`;
		default:
			return null;
	}
}

/** Statuses that fail the gate: every one of them is a file that grew past its budget. */
export const FAILING_STATUSES = Object.freeze([
	'invalid-exception',
	'over-ratchet',
	'over-warning-ratchet',
	'over-ceiling',
	'unratcheted-warning-band',
]);

function canonicalRepositoryPath(repositoryPath) {
	return Boolean(repositoryPath)
		&& !repositoryPath.startsWith('/')
		&& !repositoryPath.startsWith('../')
		&& repositoryPath === posix.normalize(repositoryPath);
}

function sortedRecord(record) {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => (
		left < right ? -1 : left > right ? 1 : 0
	)));
}
