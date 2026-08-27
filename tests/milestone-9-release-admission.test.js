/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	evaluateMilestone9ReleaseAdmission,
	parseMilestone9GuidedVerification,
} from '../scripts/lib/milestone-9-release-admission.mjs';

const ROOT = new URL('../', import.meta.url);
const RECORD_URL = new URL('docs/milestone-9-guided-verification.md', ROOT);
const CHECK_ROW = /^(\| [A-Z]{2,3}-\d{2} \| .*? \| )pending( \| )pending( \| .*? \|)$/gmu;

function passingRecord(markdown) {
	const withRowsAndIdentity = markdown
		.replace(CHECK_ROW, '$1pass$2run:M9-RUN-001$3')
		.replace('| Campaign identifier | pending |', '| Campaign identifier | M9-CAMPAIGN-001 |')
		.replace('| Campaign coordinator | pending |', '| Campaign coordinator | Release owner |')
		.replace('| Release candidate | pending |', '| Release candidate | 1.0.0-rc.1 |')
		.replace('| Baseline commit SHA | pending |', '| Baseline commit SHA | abcdef0123456789 |')
		.replace('| Supported-matrix decision | pending |', '| Supported-matrix decision | decision:matrix-1 |')
		.replace('| Automated gate artifact | pending |', '| Automated gate artifact | artifact:gates-1 |')
		.replace('| Evidence root | pending |', '| Evidence root | evidence:m9-campaign-1 |')
		.replace(
			'| pending | pending | pending | pending | pending | pending | pending | pending |',
			'| M9-RUN-001 | 2026-08-27T12:00:00Z | Verifier | abcdef0 / package-1 | both / release matrix | matrix-1 | exact hardware | evidence:run-1 |',
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

test('the parser finds the exact canonical human-check inventory without mutating it', async () => {
	const markdown = await readFile(RECORD_URL, 'utf8');
	const parsed = parseMilestone9GuidedVerification(markdown);
	assert.equal(parsed.rows.length, 152);
	assert.deepEqual(parsed.duplicateIds, []);
	assert.deepEqual(parsed.missingIds, []);
	assert.deepEqual(parsed.unexpectedIds, []);
	assert.equal(parsed.runIdentity.get('Stable release'), '1.0.0');
	assert.deepEqual(parsed.executions, []);
	assert.equal(parsed.completion.get('Stable 1.0 release conclusion'), 'pending');
	assert.equal(await readFile(RECORD_URL, 'utf8'), markdown);
});

test('pending human checks block only the explicit stable 1.0 release decision', async () => {
	const markdown = await readFile(RECORD_URL, 'utf8');
	const result = evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(markdown));
	assert.equal(result.releaseVersion, '1.0.0');
	assert.equal(result.admitted, false);
	assert.equal(result.counts.pending, 152);
	assert.ok(result.reasons.includes('152 human checks remain pending.'));
	assert.ok(result.reasons.includes('7 required campaign identity fields remain pending.'));
	assert.ok(result.reasons.includes('No execution ledger entries are recorded.'));
	assert.ok(result.reasons.includes('The Stable 1.0 release conclusion is not pass.'));
});

test('all observed passes plus the explicit conclusion admit stable 1.0', async () => {
	const markdown = passingRecord(await readFile(RECORD_URL, 'utf8'));
	const result = evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(markdown));
	assert.equal(result.admitted, true);
	assert.deepEqual(result.reasons, []);
	assert.equal(result.counts.pass, 152);
	assert.deepEqual(result.referencedRunIds, ['M9-RUN-001']);
});

test('pass rows must cite a recorded execution from the same campaign', async () => {
	const passing = passingRecord(await readFile(RECORD_URL, 'utf8'));
	const unknownRun = passing.replace('run:M9-RUN-001', 'run:M9-RUN-999');
	assert.match(
		evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(unknownRun)).reasons.join('\n'),
		/run:M9-RUN-999.*execution ledger/iu,
	);
});

test('failures, blockers, and undocumented scope reductions remain release blockers', async () => {
	const passing = passingRecord(await readFile(RECORD_URL, 'utf8'));
	const failed = passing.replace('| pass | run:M9-RUN-001 | — |', '| fail | run:M9-RUN-001 | issue:123 |');
	const blocked = passing.replace('| pass | run:M9-RUN-001 | — |', '| blocked | blocker:missing-lab | — |');
	const undocumented = passing.replace('| pass | run:M9-RUN-001 | — |', '| not-applicable | scope reduced | — |');
	assert.equal(evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(failed)).admitted, false);
	assert.equal(evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(blocked)).admitted, false);
	assert.match(
		evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(undocumented)).reasons.join('\n'),
		/not-applicable.*decision:/iu,
	);
	const approved = undocumented.replace('scope reduced', 'decision:release-scope-17');
	assert.equal(evaluateMilestone9ReleaseAdmission(parseMilestone9GuidedVerification(approved)).admitted, true);
});

test('the opt-in CLI is read-only, exits nonzero for the checked-in record, and is absent from normal gates', async () => {
	const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'));
	assert.equal(packageJson.scripts['release:1.0:admission'], 'node scripts/check-milestone-9-release-admission.mjs');
	assert.equal(packageJson.scripts['release:1.0:admission:json'], 'node scripts/check-milestone-9-release-admission.mjs --json');
	for (const name of ['build', 'test', 'check', 'check:static']) {
		assert.doesNotMatch(packageJson.scripts[name], /release:1\.0:admission/u);
	}

	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m9-admission-'));
	const path = join(directory, 'record.md');
	const passing = passingRecord(await readFile(RECORD_URL, 'utf8'));
	await writeFile(path, passing, 'utf8');
	const output = execFileSync(
		process.execPath,
		['scripts/check-milestone-9-release-admission.mjs', '--record', path, '--json'],
		{ cwd: new URL('.', ROOT), encoding: 'utf8' },
	);
	assert.equal(JSON.parse(output).admitted, true);
	assert.equal(await readFile(path, 'utf8'), passing);

	const checkedIn = spawnSync(process.execPath, ['scripts/check-milestone-9-release-admission.mjs'], {
		cwd: new URL('.', ROOT),
		encoding: 'utf8',
	});
	assert.equal(checkedIn.status, 1);
	assert.match(checkedIn.stdout, /Stable 1\.0 release is blocked/iu);
});
