/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateSoundscaperStable1BehaviorEnvironmentCoverage } from './soundscaper-stable-1-behavior-environments.mjs';
import {
	SOUNDSCAPER_STABLE_1_CHECKS,
	SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS,
} from './soundscaper-stable-1-check-inventory.mjs';
import { readProductReleaseLinesSync, validateProductReleaseLines } from './product-release-lines.mjs';
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
	'Product',
	'Stable release',
	'Release candidate',
	'Release candidate commit SHA',
	'Desktop preview workflow run ID',
	'Release candidate package inventory SHA-256',
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
	'Soundscaper native evidence location',
	'Delivery and interchange evidence location',
	'Local assistance evidence location',
	'Accessibility evidence location',
	'Localization evidence location',
	'Compatibility and migration evidence location',
	'Security and licensing evidence location',
	'Recovery evidence location',
	'Release rehearsal evidence location',
	'Reviewed decisions recorded, with reviewer',
	'Soundscaper Stable 1 release conclusion',
]);
const CHECK_ROW = /^\| (?<id>[A-Z]{2,3}-\d{2}) \| (?<check>.+?) \| (?<result>[a-z-]+) \| (?<notes>.+?) \| (?<issue>.*?) \|$/gmu;
const FIELD_ROW = /^\| (?<field>[^|]+?) \| (?<value>[^|]+?) \|$/gmu;
const RUN_REFERENCE = /(?:^|\s)run:[A-Za-z0-9._-]+(?:\s|$)/u;
const RUN_REFERENCES = /(?:^|\s)run:(?<id>[A-Za-z0-9._-]+)/gu;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const REQUIRED_PROFESSIONAL_NATIVE_TARGET_IDS = Object.freeze([
	'linux-x64',
	'linux-arm64',
	'mac-arm64',
	'win-x64',
	'win-arm64',
]);
const MAXIMUM_CANDIDATE_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

const DEFAULT_RELEASE_LINES = readProductReleaseLinesSync();
const DEFAULT_RELEASE_LINE = DEFAULT_RELEASE_LINES.products.soundscaper;
if (DEFAULT_RELEASE_LINE.stable.admissionProfile !== 'soundscaper-stable-1') {
	throw new Error('Soundscaper Stable 1 release admission does not own the declared admission profile.');
}
export const SOUNDSCAPER_STABLE_1_RELEASE_VERSION = DEFAULT_RELEASE_LINE.stable.version;
export { SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS } from './soundscaper-stable-1-check-inventory.mjs';

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

export function parseSoundscaperStable1GuidedVerification(markdown) {
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
	const expectedIds = new Set(SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS);
	const expectedChecks = new Map(SOUNDSCAPER_STABLE_1_CHECKS.map(({ id, check }) => [id, check]));
	const executions = executionLedger(markdown);
	return {
		rows,
		runIdentity: fieldsOf(markdown, 'Run identity'),
		executions,
		duplicateRunIds: duplicateValues(executions.map(({ runId }) => runId)),
		completion: fieldsOf(markdown, 'Completion record'),
		duplicateIds: [...countsById].filter(([, count]) => count > 1).map(([id]) => id),
		missingIds: SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS.filter((id) => !actualIds.has(id)),
		unexpectedIds: [...actualIds].filter((id) => !expectedIds.has(id)),
		changedIds: rows.filter(({ id, check }) => expectedChecks.has(id)
			&& expectedChecks.get(id) !== check).map(({ id }) => id),
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

function positiveSafeInteger(value) {
	if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function candidateArtifactNames(version) {
	const packageName = (target, extension) => `Soundscaper-${version}-${target}.${extension}`;
	return Object.freeze({
		'linux-x64': Object.freeze([
			packageName('linux-x86_64', 'AppImage'), packageName('linux-amd64', 'deb'),
			'runtime-manifest-soundscaper-linux-x64.json',
		].sort()),
		'linux-arm64': Object.freeze([
			packageName('linux-arm64', 'AppImage'), packageName('linux-arm64', 'deb'),
			'runtime-manifest-soundscaper-linux-arm64.json',
		].sort()),
		'mac-arm64': Object.freeze([
			packageName('mac-arm64', 'dmg'), 'runtime-manifest-soundscaper-mac-arm64.json',
		].sort()),
		'win-x64': Object.freeze([
			packageName('win-x64', 'exe'), packageName('win-x64', 'zip'),
			'runtime-manifest-soundscaper-win-x64.json',
		].sort()),
		'win-arm64': Object.freeze([
			packageName('win-arm64', 'exe'), packageName('win-arm64', 'zip'),
			'runtime-manifest-soundscaper-win-arm64.json',
		].sort()),
	});
}

export function validateSoundscaperStable1ReleaseCandidateIdentity(value) {
	const expected = DEFAULT_RELEASE_LINE.candidate;
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| value.version !== expected.version || value.tag !== `${expected.tagPrefix}${expected.version}`
		|| !COMMIT_SHA.test(value.commitSha ?? '')
		|| !Number.isSafeInteger(value.desktopPreviewWorkflowRunId)
		|| value.desktopPreviewWorkflowRunId < 1
		|| !SHA256.test(value.packageInventorySha256 ?? '')) {
		throw new TypeError('The admitted Soundscaper release-candidate identity is invalid.');
	}
	return Object.freeze({
		version: value.version,
		tag: value.tag,
		commitSha: value.commitSha,
		desktopPreviewWorkflowRunId: value.desktopPreviewWorkflowRunId,
		packageInventorySha256: value.packageInventorySha256,
	});
}

export async function authenticateSoundscaperStable1CandidateArtifact({
	candidate: candidateValue, targetId, inventoryPath, artifactRoot,
}) {
	const candidate = validateSoundscaperStable1ReleaseCandidateIdentity(candidateValue);
	const targetNames = candidateArtifactNames(candidate.version);
	if (!Object.hasOwn(targetNames, targetId)) throw new TypeError('Stable candidate target is invalid.');
	const [inventoryMetadata, artifactMetadata] = await Promise.all([
		lstat(inventoryPath), lstat(artifactRoot),
	]);
	if (!inventoryMetadata.isFile() || inventoryMetadata.isSymbolicLink()
		|| inventoryMetadata.size < 1 || inventoryMetadata.size > 128 * 1024) {
		throw new Error('The candidate package inventory file is invalid.');
	}
	if (!artifactMetadata.isDirectory() || artifactMetadata.isSymbolicLink()) {
		throw new Error('The candidate target artifact root is invalid.');
	}
	const inventoryBytes = await readFile(inventoryPath);
	if (sha256(inventoryBytes) !== candidate.packageInventorySha256) {
		throw new Error('The candidate package inventory does not match admission.');
	}
	const inventoryText = new TextDecoder('utf-8', { fatal: true }).decode(inventoryBytes);
	const lines = inventoryText.endsWith('\n') ? inventoryText.slice(0, -1).split('\n') : [];
	const inventory = new Map();
	for (const line of lines) {
		const match = /^(?<digest>[a-f0-9]{64}) {2}(?<name>[^/\\\0\r\n]+)$/u.exec(line);
		if (!match || match.groups.name === '.' || match.groups.name === '..'
			|| inventory.has(match.groups.name)) {
			throw new Error('The candidate package inventory is not canonical.');
		}
		inventory.set(match.groups.name, match.groups.digest);
	}
	const inventoryNames = [...inventory.keys()];
	const requiredInventoryNames = Object.values(targetNames).flat().sort();
	if (JSON.stringify(inventoryNames) !== JSON.stringify([...inventoryNames].sort())
		|| requiredInventoryNames.some((name) => !inventory.has(name))
		|| inventoryNames.some((name) => /framescaper/iu.test(name))) {
		throw new Error('The candidate package inventory ordering or membership is invalid.');
	}
	const entries = await readdir(artifactRoot, { withFileTypes: true });
	const artifactNames = entries.map(({ name }) => name).sort();
	if (entries.some((entry) => !entry.isFile())
		|| JSON.stringify(artifactNames) !== JSON.stringify(targetNames[targetId])) {
		throw new Error('The candidate target artifact membership is invalid.');
	}
	for (const name of artifactNames) {
		const path = join(artifactRoot, name);
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1
			|| metadata.size > MAXIMUM_CANDIDATE_PACKAGE_BYTES
			|| await sha256File(path) !== inventory.get(name)) {
			throw new Error(`Candidate artifact entry ${name} failed its inventory digest.`);
		}
	}
	return Object.freeze({
		targetId,
		inventorySha256: candidate.packageInventorySha256,
		artifactNames: Object.freeze(artifactNames),
	});
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

function evaluateQualificationEvidenceAudit(value) {
	if (value === undefined) {
		return {
			summary: null,
			reasons: ['Soundscaper Stable 1 qualification evidence audit is missing.'],
		};
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return {
			summary: null,
			reasons: ['Soundscaper Stable 1 qualification evidence audit is invalid.'],
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
		sourceRevision: typeof value.sourceRevision === 'string' ? value.sourceRevision : null,
		packageInventorySha256: typeof value.packageInventorySha256 === 'string'
			? value.packageInventorySha256 : null,
		requiredCellCount: Number.isSafeInteger(value.requiredCellCount) ? value.requiredCellCount : null,
		requiredRunCount: Number.isSafeInteger(value.requiredRunCount) ? value.requiredRunCount : null,
		auditedRunCount: Number.isSafeInteger(value.auditedRunCount) ? value.auditedRunCount : null,
		blockers,
	};
	const reasons = [];
	if (!summary.passed) reasons.push('Soundscaper Stable 1 qualification evidence audit did not pass.');
	if (!summary.qualificationReady) {
		const progress = summary.auditedRunCount !== null && summary.requiredRunCount !== null
			? `; ${summary.auditedRunCount}/${summary.requiredRunCount} required runs audited`
			: '';
		const detail = blockers.length > 0 ? `: ${blockers.join(' ')}` : '.';
		reasons.push(`Soundscaper Stable 1 qualification evidence is not ready${progress}${detail}`);
	} else if (summary.status !== 'accepted'
		|| summary.workloadId !== 'soundscaper-stable-1-complete-system-soak'
		|| summary.matrixId === null
		|| !COMMIT_SHA.test(summary.sourceRevision ?? '')
		|| !SHA256.test(summary.packageInventorySha256 ?? '')
		|| !Number.isSafeInteger(summary.requiredCellCount) || summary.requiredCellCount < 1
		|| summary.requiredRunCount !== summary.requiredCellCount * 2
		|| summary.auditedRunCount !== summary.requiredRunCount
		|| blockers.length > 0) {
		reasons.push('Soundscaper Stable 1 qualification-ready audit summary is inconsistent.');
	}
	return { summary, reasons };
}

function evaluateProfessionalNativeReadinessAudit(value, candidateCommitSha) {
	if (value === undefined) {
		return {
			summary: null,
			reasons: ['Soundscaper professional native-readiness audit is missing.'],
		};
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return {
			summary: null,
			reasons: ['Soundscaper professional native-readiness audit is invalid.'],
		};
	}
	const targets = Array.isArray(value.targets) ? value.targets : [];
	const aggregateBlockers = Array.isArray(value.blockers) ? value.blockers : [];
	const summary = {
		passed: false,
		schemaVersion: value.schemaVersion === 1 ? 1 : null,
		status: typeof value.status === 'string' ? value.status : null,
		requiredTargetCount: REQUIRED_PROFESSIONAL_NATIVE_TARGET_IDS.length,
		readyTargetCount: targets.filter((target) => target !== null
			&& typeof target === 'object' && !Array.isArray(target)
			&& target.status === 'ready').length,
		targets: targets.map((target) => target !== null
			&& typeof target === 'object' && !Array.isArray(target) ? {
				id: typeof target.id === 'string' ? target.id : null,
				status: typeof target.status === 'string' ? target.status : null,
				sourceRevision: typeof target.sourceRevision === 'string'
					? target.sourceRevision : null,
				blockers: Array.isArray(target.blockers)
					&& target.blockers.every((blocker) => typeof blocker === 'string' && blocker.length > 0)
					? [...target.blockers] : null,
				payloadSha256: typeof target.payloadSha256 === 'string' ? target.payloadSha256 : null,
				buildCandidateSha256: typeof target.buildCandidateSha256 === 'string'
					? target.buildCandidateSha256 : null,
				productionReadinessSha256: typeof target.productionReadinessSha256 === 'string'
					? target.productionReadinessSha256 : null,
			} : null),
		blockers: aggregateBlockers.map((blocker) => blocker !== null
			&& typeof blocker === 'object' && !Array.isArray(blocker) ? {
				target: typeof blocker.target === 'string' ? blocker.target : null,
				detail: typeof blocker.detail === 'string' ? blocker.detail : null,
			} : null),
	};
	const reasons = [];
	if (summary.schemaVersion !== 1) {
		reasons.push('Soundscaper professional native-readiness audit schema is invalid.');
	}
	if (summary.status !== 'ready') {
		const detail = summary.blockers
			.filter((blocker) => blocker?.detail)
			.map((blocker) => `${blocker.target ?? 'unknown target'}: ${blocker.detail}`)
			.join(' ');
		reasons.push(`Soundscaper professional native-readiness audit is not ready${detail ? `: ${detail}` : '.'}`);
	}
	if (!Array.isArray(value.blockers) || summary.blockers.some((blocker) => blocker === null
		|| !REQUIRED_PROFESSIONAL_NATIVE_TARGET_IDS.includes(blocker.target)
		|| blocker.detail === null || blocker.detail.length === 0)) {
		reasons.push('Soundscaper professional native-readiness blocker inventory is invalid.');
	} else if (summary.status === 'ready' && summary.blockers.length > 0) {
		reasons.push('Soundscaper professional native-readiness ready audit retains blockers.');
	}
	if (!Array.isArray(value.targets)) {
		reasons.push('Soundscaper professional native-readiness target inventory is invalid.');
	} else if (targets.length !== REQUIRED_PROFESSIONAL_NATIVE_TARGET_IDS.length) {
		reasons.push('Soundscaper professional native-readiness audit does not contain exactly five targets.');
	}
	for (const [index, expectedId] of REQUIRED_PROFESSIONAL_NATIVE_TARGET_IDS.entries()) {
		const target = summary.targets[index];
		if (target === undefined) continue;
		if (target === null || target.id !== expectedId) {
			reasons.push(`Soundscaper professional native-readiness target ${index + 1} is not ${expectedId}.`);
			continue;
		}
		if (target.status === 'blocked') {
			if (target.blockers === null || target.blockers.length === 0) {
				reasons.push(`Soundscaper professional native target ${expectedId} has no blocker detail.`);
			}
			continue;
		}
		if (target.status !== 'ready') {
			reasons.push(`Soundscaper professional native target ${expectedId} is not ready.`);
		}
		if (!COMMIT_SHA.test(target.sourceRevision ?? '')) {
			reasons.push(`Soundscaper professional native target ${expectedId} has an invalid source revision.`);
		} else if (target.sourceRevision !== candidateCommitSha) {
			reasons.push(
				`Soundscaper professional native target ${expectedId} source revision does not match the admitted release candidate.`,
			);
		}
		for (const field of ['payloadSha256', 'buildCandidateSha256', 'productionReadinessSha256']) {
			if (!SHA256.test(target[field] ?? '')) {
				reasons.push(`Soundscaper professional native target ${expectedId} has invalid ${field}.`);
			}
		}
	}
	summary.passed = reasons.length === 0;
	return { summary, reasons };
}

export function evaluateSoundscaperStable1ReleaseAdmission(parsed, options = {}) {
	const reasons = [];
	const releaseLines = options.releaseLines === undefined
		? DEFAULT_RELEASE_LINES
		: validateProductReleaseLines(options.releaseLines);
	const releaseLine = releaseLines.products.soundscaper;
	const counts = resultCounts(parsed.rows);
	addCountReason(reasons, parsed.missingIds.length, 'required human-check ID is missing.', 'required human-check IDs are missing.');
	addCountReason(reasons, parsed.unexpectedIds.length, 'unexpected human-check ID is present.', 'unexpected human-check IDs are present.');
	addCountReason(reasons, parsed.duplicateIds.length, 'human-check ID is duplicated.', 'human-check IDs are duplicated.');
	addCountReason(reasons, parsed.changedIds.length, 'human-check text changed from the inventory.',
		'human-check texts changed from the inventory.');
	const unknownResults = parsed.rows.filter(({ result }) => !ALLOWED_RESULTS.includes(result));
	addCountReason(reasons, unknownResults.length, 'human check has an unknown result.', 'human checks have unknown results.');
	addCountReason(reasons, counts.pending, 'human check remains pending.', 'human checks remain pending.');
	addCountReason(reasons, counts.fail, 'human check is failing.', 'human checks are failing.');
	addCountReason(reasons, counts.blocked, 'human check is blocked.', 'human checks are blocked.');
	addCountReason(reasons, counts['not-applicable'],
		'in-scope human check is marked not-applicable.',
		'in-scope human checks are marked not-applicable.');
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
	if (parsed.runIdentity.get('Product') !== 'soundscaper') {
		reasons.push('The campaign does not identify Soundscaper as its only product.');
	}
	if (releaseLine.stable.admissionProfile !== 'soundscaper-stable-1') {
		reasons.push('The Soundscaper release line does not delegate to this admission profile.');
	}
	if (parsed.runIdentity.get('Stable release') !== releaseLine.stable.version) {
		reasons.push(`The campaign does not identify stable release ${releaseLine.stable.version}.`);
	}
	if (parsed.runIdentity.get('Release candidate') !== releaseLine.candidate.version) {
		reasons.push(`The campaign does not identify candidate ${releaseLine.candidate.version}.`);
	}
	const candidateCommitSha = parsed.runIdentity.get('Release candidate commit SHA');
	const desktopPreviewWorkflowRunId = positiveSafeInteger(
		parsed.runIdentity.get('Desktop preview workflow run ID'),
	);
	const packageInventorySha256 = parsed.runIdentity.get(
		'Release candidate package inventory SHA-256',
	);
	if (!COMMIT_SHA.test(candidateCommitSha ?? '')) {
		reasons.push('The release-candidate commit SHA is not an exact lowercase 40-character Git commit ID.');
	}
	if (desktopPreviewWorkflowRunId === null) {
		reasons.push('The desktop-preview workflow run ID is not a positive safe integer.');
	}
	if (!SHA256.test(packageInventorySha256 ?? '')) {
		reasons.push('The release-candidate package inventory SHA-256 is invalid.');
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
	if (parsed.completion.get('Soundscaper Stable 1 release conclusion') !== 'pass') {
		reasons.push('The Soundscaper Stable 1 release conclusion is not pass.');
	}
	let behaviorEnvironmentCoverage = null;
	if (options.behaviorEnvironmentMatrix !== undefined) {
		behaviorEnvironmentCoverage = evaluateSoundscaperStable1BehaviorEnvironmentCoverage(
			parsed, options.behaviorEnvironmentMatrix,
		);
		reasons.push(...behaviorEnvironmentCoverage.reasons);
	}
	const qualificationEvidence = evaluateQualificationEvidenceAudit(
		options.qualificationEvidenceAudit,
	);
	reasons.push(...qualificationEvidence.reasons);
	if (qualificationEvidence.summary?.qualificationReady) {
		if (qualificationEvidence.summary.sourceRevision !== candidateCommitSha) {
			reasons.push('Soundscaper Stable 1 qualification source revision does not match the admitted release candidate.');
		}
		if (qualificationEvidence.summary.packageInventorySha256 !== packageInventorySha256) {
			reasons.push('Soundscaper Stable 1 qualification package inventory does not match the admitted release candidate.');
		}
	}
	const nativeReadiness = evaluateProfessionalNativeReadinessAudit(
		options.nativeReadinessAudit, candidateCommitSha,
	);
	reasons.push(...nativeReadiness.reasons);
	return {
		productId: 'soundscaper',
		releaseVersion: releaseLine.stable.version,
		releaseCandidate: {
			version: releaseLine.candidate.version,
			tag: `${releaseLine.candidate.tagPrefix}${releaseLine.candidate.version}`,
			commitSha: COMMIT_SHA.test(candidateCommitSha ?? '') ? candidateCommitSha : null,
			desktopPreviewWorkflowRunId,
			packageInventorySha256: SHA256.test(packageInventorySha256 ?? '')
				? packageInventorySha256 : null,
		},
		admitted: reasons.length === 0,
		counts,
		referencedRunIds,
		behaviorEnvironmentCoverage,
		qualificationEvidence: qualificationEvidence.summary,
		nativeReadiness: nativeReadiness.summary,
		reasons,
	};
}
