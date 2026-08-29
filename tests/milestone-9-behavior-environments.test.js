/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	evaluateMilestone9BehaviorEnvironmentCoverage,
	expandMilestone9BehaviorEnvironmentRequirements,
	validateMilestone9BehaviorEnvironmentMatrix,
} from '../scripts/lib/milestone-9-behavior-environments.mjs';
import {
	MILESTONE_9_EXPECTED_CHECK_IDS,
	evaluateMilestone9ReleaseAdmission,
	parseMilestone9GuidedVerification,
} from '../scripts/lib/milestone-9-release-admission.mjs';
import { NATIVE_OS_LAB_PROFILES_V2 } from '../scripts/lib/native-os-lab-schema.mjs';

const ROOT = new URL('../', import.meta.url);
const MATRIX_URL = new URL('config/milestone-9-behavior-environments.json', ROOT);
const RECORD_URL = new URL('docs/milestone-9-guided-verification.md', ROOT);
const CHECK_ROW = /^(\| (?<id>[A-Z]{2,3}-\d{2}) \| .*? \| )pending( \| )pending( \| .*? \|)$/gmu;
const QUALIFICATION_READY = Object.freeze({
	passed: true,
	qualificationReady: true,
	status: 'accepted',
	workloadId: 'm9-complete-system-soak',
	matrixId: 'stable-1-0-full-browser-five-desktop-native-v1',
	requiredCellCount: 11,
	requiredRunCount: 22,
	auditedRunCount: 22,
	blockers: Object.freeze([]),
});

test('the behavior matrix expands every canonical check over the approved release cells', async () => {
	const matrix = validateMilestone9BehaviorEnvironmentMatrix(
		JSON.parse(await readFile(MATRIX_URL, 'utf8')),
	);
	const requirements = expandMilestone9BehaviorEnvironmentRequirements(matrix);

	assert.deepEqual([...requirements.keys()], [...MILESTONE_9_EXPECTED_CHECK_IDS]);
	assert.equal(requirements.size, 152);
	assert.equal(requirements.get('SB-01').length, 6);
	assert.equal(requirements.get('FB-17').length, 6);
	assert.equal(requirements.get('SD-01').length, 5);
	assert.equal(requirements.get('FD-06').length, 5);
	assert.equal(requirements.get('SN-01').length, 11);
	assert.equal(requirements.get('FN-14').length, 7);
	assert.equal(requirements.get('REL-04').length, 2);
	assert.ok([...requirements.values()].every((cellIds) => cellIds.length > 0));
	assert.deepEqual(
		new Set(matrix.cells.filter(({ kind }) => kind === 'native-profile').map(({ id }) => id)),
		new Set(NATIVE_OS_LAB_PROFILES_V2.map(({ id }) => id)),
	);
});

test('stable admission requires a cited execution for every applicable behavior cell', async () => {
	const matrix = validateMilestone9BehaviorEnvironmentMatrix(
		JSON.parse(await readFile(MATRIX_URL, 'utf8')),
	);
	const requirements = expandMilestone9BehaviorEnvironmentRequirements(matrix);
	const complete = passingRecord(await readFile(RECORD_URL, 'utf8'), requirements);
	const parsed = parseMilestone9GuidedVerification(complete);
	const coverage = evaluateMilestone9BehaviorEnvironmentCoverage(parsed, matrix);

	assert.equal(coverage.passed, true);
	assert.equal(coverage.requiredBehaviorCount, 152);
	assert.equal(coverage.missingCells.length, 0);
	assert.equal(evaluateMilestone9ReleaseAdmission(parsed, {
		behaviorEnvironmentMatrix: matrix,
		qualificationEvidenceAudit: QUALIFICATION_READY,
	}).admitted, true);

	const missing = complete.replace('run:M9-browser-chromium-current ', '');
	const result = evaluateMilestone9ReleaseAdmission(
		parseMilestone9GuidedVerification(missing),
		{
			behaviorEnvironmentMatrix: matrix,
			qualificationEvidenceAudit: QUALIFICATION_READY,
		},
	);
	assert.equal(result.admitted, false);
	assert.match(result.reasons.join('\n'), /SB-01.*browser-chromium-current/iu);
});

test('execution rows bind one known cell and cannot cover a neighbor by free text', async () => {
	const matrix = validateMilestone9BehaviorEnvironmentMatrix(
		JSON.parse(await readFile(MATRIX_URL, 'utf8')),
	);
	const requirements = expandMilestone9BehaviorEnvironmentRequirements(matrix);
	const complete = passingRecord(await readFile(RECORD_URL, 'utf8'), requirements);
	const unknown = complete.replace('cell:browser-chromium-current', 'cell:browser-invented');
	const coverage = evaluateMilestone9BehaviorEnvironmentCoverage(
		parseMilestone9GuidedVerification(unknown), matrix,
	);
	assert.equal(coverage.passed, false);
	assert.ok(coverage.reasons.some((reason) => /unknown environment cell/iu.test(reason)));

	const ambiguous = complete.replace(
		'cell:browser-chromium-current',
		'cell:browser-chromium-current cell:browser-firefox-current',
	);
	assert.match(
		evaluateMilestone9BehaviorEnvironmentCoverage(
			parseMilestone9GuidedVerification(ambiguous), matrix,
		).reasons.join('\n'),
		/exactly one cell:/iu,
	);
});

function passingRecord(markdown, requirements) {
	const runIds = new Map();
	for (const cellIds of requirements.values()) {
		for (const cellId of cellIds) runIds.set(cellId, `M9-${cellId}`);
	}
	const withRowsAndIdentity = markdown
		.replace(CHECK_ROW, (...arguments_) => {
			const groups = arguments_.at(-1);
			const [, leading, , separator, trailing] = arguments_;
			const notes = requirements.get(groups.id).map((cellId) => `run:${runIds.get(cellId)}`).join(' ');
			return `${leading}pass${separator}${notes}${trailing}`;
		})
		.replace('| Campaign identifier | pending |', '| Campaign identifier | M9-CAMPAIGN-001 |')
		.replace('| Campaign coordinator | pending |', '| Campaign coordinator | Release owner |')
		.replace('| Release candidate | pending |', '| Release candidate | 1.0.0-rc.1 |')
		.replace('| Baseline commit SHA | pending |', '| Baseline commit SHA | abcdef0123456789 |')
		.replace('| Supported-matrix decision | pending |', '| Supported-matrix decision | decision:matrix-1 |')
		.replace('| Automated gate artifact | pending |', '| Automated gate artifact | artifact:gates-1 |')
		.replace('| Evidence root | pending |', '| Evidence root | evidence:m9-campaign-1 |')
		.replace(
			'| pending | pending | pending | pending | pending | pending | pending | pending |',
			[...runIds].map(([cellId, runId]) => (
				`| ${runId} | 2026-09-01T12:00:00Z | Verifier | abcdef0 / package-1 | both | cell:${cellId} | exact hardware | evidence:${runId} |`
			)).join('\n'),
		);
	const marker = '## Completion record';
	const markerIndex = withRowsAndIdentity.indexOf(marker);
	return `${withRowsAndIdentity.slice(0, markerIndex)}${withRowsAndIdentity.slice(markerIndex).replace(
		/^\| (?<field>[^|]+?) \| pending \|$/gmu,
		(_row, ...arguments_) => {
			const { field } = arguments_.at(-1);
			return `| ${field} | ${field === 'Stable 1.0 release conclusion' ? 'pass' : 'recorded'} |`;
		},
	)}`;
}
