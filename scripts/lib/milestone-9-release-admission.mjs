/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateMilestone9BehaviorEnvironmentCoverage } from './milestone-9-behavior-environments.mjs';
import { MILESTONE_9_EXPECTED_CHECK_IDS } from './milestone-9-check-inventory.mjs';
const ALLOWED_RESULTS = Object.freeze([
	'pending',
	'pass',
	'fail',
	'blocked',
	'not-applicable',
]);
const REQUIRED_CAMPAIGN_FIELDS = Object.freeze([
	'Campaign identifier',
	'Campaign coordinator',
	'Stable release',
	'Release candidate',
	'Baseline commit SHA',
	'Supported-matrix decision',
	'Automated gate artifact',
	'Evidence root',
]);
const REQUIRED_COMPLETION_FIELDS = Object.freeze([
	'All in-scope rows pass',
	'Approved scope-reduction decisions',
	'Rows recorded blocked, with the blocker named',
	'Automated gate log/artifact',
	'Hosted qualification metrics artifact',
	'Browser evidence location',
	'Soundscaper desktop evidence location',
	'Framescaper desktop evidence location',
	'Paired-product isolation evidence location',
	'Soundscaper native evidence location',
	'Framescaper native evidence location',
	'Delivery and interchange evidence location',
	'Local assistance evidence location',
	'Capture evidence location',
	'Release rehearsal evidence location',
	'Reviewed decisions recorded, with reviewer',
	'Stable 1.0 release conclusion',
]);
const CHECK_ROW = /^\| (?<id>[A-Z]{2,3}-\d{2}) \| (?<check>.+?) \| (?<result>[a-z-]+) \| (?<notes>.+?) \| (?<issue>.*?) \|$/gmu;
const FIELD_ROW = /^\| (?<field>[^|]+?) \| (?<value>[^|]+?) \|$/gmu;
const RUN_REFERENCE = /(?:^|\s)run:[A-Za-z0-9._-]+(?:\s|$)/u;
const RUN_REFERENCES = /(?:^|\s)run:(?<id>[A-Za-z0-9._-]+)/gu;
const DECISION_REFERENCE = /(?:^|\s)decision:[A-Za-z0-9._:/-]+(?:\s|$)/u;

export const MILESTONE_9_RELEASE_VERSION = '1.0.0';
export { MILESTONE_9_EXPECTED_CHECK_IDS } from './milestone-9-check-inventory.mjs';

function section(markdown, title) {
	const marker = `## ${title}`;
	const start = markdown.indexOf(marker);
	if (start < 0) return '';
	const bodyStart = start + marker.length;
	const nextHeading = markdown.indexOf('\n## ', bodyStart);
	return markdown.slice(bodyStart, nextHeading < 0 ? markdown.length : nextHeading);
}

function fieldsOf(markdown, title) {
	const fields = new Map();
	for (const match of section(markdown, title).matchAll(FIELD_ROW)) {
		const { field, value } = match.groups;
		if (field === 'Field' || field === '---') continue;
		fields.set(field.trim(), value.trim());
	}
	return fields;
}

function executionLedger(markdown) {
	const executions = [];
	for (const line of section(markdown, 'Execution ledger').split('\n')) {
		if (!line.startsWith('| ') || !line.endsWith(' |')) continue;
		const cells = line.slice(2, -2).split(' | ').map((cell) => cell.trim());
		if (cells.length !== 8 || cells[0] === 'Run ID' || cells.every((cell) => cell === '---')) continue;
		if (cells.every((cell) => cell === 'pending')) continue;
		const [runId, date, verifier, build, target, environment, runtime, evidence] = cells;
		executions.push({ runId, date, verifier, build, target, environment, runtime, evidence });
	}
	return executions;
}

function duplicateValues(values) {
	const counts = new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

export function parseMilestone9GuidedVerification(markdown) {
	if (typeof markdown !== 'string') throw new TypeError('The guided-verification record must be Markdown text.');
	const rows = [...markdown.matchAll(CHECK_ROW)].map(({ groups }) => ({
		id: groups.id,
		check: groups.check.trim(),
		result: groups.result,
		notes: groups.notes.trim(),
		issue: groups.issue.trim(),
	}));
	const countsById = new Map();
	for (const { id } of rows) countsById.set(id, (countsById.get(id) ?? 0) + 1);
	const actualIds = new Set(countsById.keys());
	const expectedIds = new Set(MILESTONE_9_EXPECTED_CHECK_IDS);
	const executions = executionLedger(markdown);
	return {
		rows,
		runIdentity: fieldsOf(markdown, 'Run identity'),
		executions,
		duplicateRunIds: duplicateValues(executions.map(({ runId }) => runId)),
		completion: fieldsOf(markdown, 'Completion record'),
		duplicateIds: [...countsById].filter(([, count]) => count > 1).map(([id]) => id),
		missingIds: MILESTONE_9_EXPECTED_CHECK_IDS.filter((id) => !actualIds.has(id)),
		unexpectedIds: [...actualIds].filter((id) => !expectedIds.has(id)),
	};
}

function runReferences(rows) {
	const ids = new Set();
	for (const { notes } of rows) {
		for (const match of notes.matchAll(RUN_REFERENCES)) ids.add(match.groups.id);
	}
	return [...ids].sort();
}

function resultCounts(rows) {
	const counts = Object.fromEntries(ALLOWED_RESULTS.map((result) => [result, 0]));
	for (const { result } of rows) {
		if (Object.hasOwn(counts, result)) counts[result] += 1;
	}
	return counts;
}

function addCountReason(reasons, count, singular, plural) {
	if (count > 0) reasons.push(`${count} ${count === 1 ? singular : plural}`);
}

function evaluateQualificationEvidenceAudit(value) {
	if (value === undefined) {
		return {
			summary: null,
			reasons: ['Milestone 9 qualification evidence audit is missing.'],
		};
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return {
			summary: null,
			reasons: ['Milestone 9 qualification evidence audit is invalid.'],
		};
	}
	const blockers = Array.isArray(value.blockers)
		&& value.blockers.every((blocker) => typeof blocker === 'string' && blocker.length > 0)
		? [...value.blockers]
		: [];
	const summary = {
		passed: value.passed === true,
		qualificationReady: value.qualificationReady === true,
		status: typeof value.status === 'string' ? value.status : null,
		workloadId: typeof value.workloadId === 'string' ? value.workloadId : null,
		matrixId: typeof value.matrixId === 'string' ? value.matrixId : null,
		requiredCellCount: Number.isSafeInteger(value.requiredCellCount) ? value.requiredCellCount : null,
		requiredRunCount: Number.isSafeInteger(value.requiredRunCount) ? value.requiredRunCount : null,
		auditedRunCount: Number.isSafeInteger(value.auditedRunCount) ? value.auditedRunCount : null,
		blockers,
	};
	const reasons = [];
	if (!summary.passed) reasons.push('Milestone 9 qualification evidence audit did not pass.');
	if (!summary.qualificationReady) {
		const progress = summary.auditedRunCount !== null && summary.requiredRunCount !== null
			? `; ${summary.auditedRunCount}/${summary.requiredRunCount} required runs audited`
			: '';
		const detail = blockers.length > 0 ? `: ${blockers.join(' ')}` : '.';
		reasons.push(`Milestone 9 qualification evidence is not ready${progress}${detail}`);
	} else if (summary.status !== 'accepted'
		|| summary.workloadId !== 'm9-complete-system-soak'
		|| summary.matrixId === null
		|| !Number.isSafeInteger(summary.requiredCellCount) || summary.requiredCellCount < 1
		|| summary.requiredRunCount !== summary.requiredCellCount * 2
		|| summary.auditedRunCount !== summary.requiredRunCount
		|| blockers.length > 0) {
		reasons.push('Milestone 9 qualification-ready audit summary is inconsistent.');
	}
	return { summary, reasons };
}

export function evaluateMilestone9ReleaseAdmission(parsed, options = {}) {
	const reasons = [];
	const counts = resultCounts(parsed.rows);
	addCountReason(reasons, parsed.missingIds.length, 'required human-check ID is missing.', 'required human-check IDs are missing.');
	addCountReason(reasons, parsed.unexpectedIds.length, 'unexpected human-check ID is present.', 'unexpected human-check IDs are present.');
	addCountReason(reasons, parsed.duplicateIds.length, 'human-check ID is duplicated.', 'human-check IDs are duplicated.');
	const unknownResults = parsed.rows.filter(({ result }) => !ALLOWED_RESULTS.includes(result));
	addCountReason(reasons, unknownResults.length, 'human check has an unknown result.', 'human checks have unknown results.');
	addCountReason(reasons, counts.pending, 'human check remains pending.', 'human checks remain pending.');
	addCountReason(reasons, counts.fail, 'human check is failing.', 'human checks are failing.');
	addCountReason(reasons, counts.blocked, 'human check is blocked.', 'human checks are blocked.');
	const incompleteCampaignFields = REQUIRED_CAMPAIGN_FIELDS.filter((field) => {
		const value = parsed.runIdentity.get(field);
		return value === undefined || value === '' || value === 'pending';
	});
	addCountReason(
		reasons,
		incompleteCampaignFields.length,
		'required campaign identity field remains pending.',
		'required campaign identity fields remain pending.',
	);
	if (parsed.runIdentity.get('Stable release') !== MILESTONE_9_RELEASE_VERSION) {
		reasons.push(`The campaign does not identify stable release ${MILESTONE_9_RELEASE_VERSION}.`);
	}
	if (parsed.executions.length === 0) reasons.push('No execution ledger entries are recorded.');
	addCountReason(reasons, parsed.duplicateRunIds.length, 'execution run ID is duplicated.', 'execution run IDs are duplicated.');

	const missingRunReferences = parsed.rows.filter(
		({ result, notes }) => (result === 'pass' || result === 'fail') && !RUN_REFERENCE.test(notes),
	);
	addCountReason(
		reasons,
		missingRunReferences.length,
		'pass/fail row does not cite run:<run-id>.',
		'pass/fail rows do not cite run:<run-id>.',
	);
	const referencedRunIds = runReferences(parsed.rows);
	const recordedRunIds = new Set(parsed.executions.map(({ runId }) => runId));
	for (const runId of referencedRunIds) {
		if (!recordedRunIds.has(runId)) reasons.push(`run:${runId} is not present in the execution ledger.`);
	}
	const undocumentedScopeReductions = parsed.rows.filter(
		({ result, notes }) => result === 'not-applicable' && !DECISION_REFERENCE.test(notes),
	);
	addCountReason(
		reasons,
		undocumentedScopeReductions.length,
		'not-applicable row does not cite decision:<reference>.',
		'not-applicable rows do not cite decision:<reference>.',
	);
	const incompleteCompletionFields = REQUIRED_COMPLETION_FIELDS.filter((field) => {
		const value = parsed.completion.get(field);
		return value === undefined || value === '' || value === 'pending';
	});
	addCountReason(
		reasons,
		incompleteCompletionFields.length,
		'required completion field remains pending.',
		'required completion fields remain pending.',
	);
	if (parsed.completion.get('Stable 1.0 release conclusion') !== 'pass') {
		reasons.push('The Stable 1.0 release conclusion is not pass.');
	}
	let behaviorEnvironmentCoverage = null;
	if (options.behaviorEnvironmentMatrix !== undefined) {
		behaviorEnvironmentCoverage = evaluateMilestone9BehaviorEnvironmentCoverage(
			parsed, options.behaviorEnvironmentMatrix,
		);
		reasons.push(...behaviorEnvironmentCoverage.reasons);
	}
	const qualificationEvidence = evaluateQualificationEvidenceAudit(
		options.qualificationEvidenceAudit,
	);
	reasons.push(...qualificationEvidence.reasons);
	return {
		releaseVersion: MILESTONE_9_RELEASE_VERSION,
		admitted: reasons.length === 0,
		counts,
		referencedRunIds,
		behaviorEnvironmentCoverage,
		qualificationEvidence: qualificationEvidence.summary,
		reasons,
	};
}
