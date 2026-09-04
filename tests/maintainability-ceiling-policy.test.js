/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessFile,
	ceilingFor,
	describeAssessment,
	FAILING_STATUSES,
	loadMaintainabilityConfig,
} from '../scripts/lib/maintainability-ceiling.mjs';
import { headroomAdvice, hookOutput } from '../scripts/hooks/report-maintainability-headroom.mjs';

const config = { schemaVersion: 1, defaultMaxLines: 600, browserSpecMaxLines: 800, warnLines: 550, allow: {
	'src/legacy.js': { maxLines: 900, reason: 'Legacy module awaiting extraction.' },
} };

test('browser specs get their own ceiling', () => {
	assert.equal(ceilingFor('tests/browser/timeline.spec.js', config), 800);
	assert.equal(ceilingFor('tests/timeline.test.js', config), 600);
	assert.equal(ceilingFor('src/common/editor/export.js', config), 600);
});

test('growth past a ceiling or a ratchet is the only thing that fails', () => {
	assert.equal(assessFile('src/new.ts', 601, config).status, 'over-ceiling');
	assert.equal(assessFile('src/legacy.js', 901, config).status, 'over-ratchet');
	for (const status of ['over-ceiling', 'over-ratchet']) assert.ok(FAILING_STATUSES.includes(status));
	for (const status of ['ok', 'near-ceiling', 'slack', 'exception-obsolete', 'at-ratchet']) {
		assert.ok(!FAILING_STATUSES.includes(status), `${status} must not fail the gate`);
	}
});

test('an allowlisted file may shrink without failing the gate', () => {
	// Failing a shrink would mean an agent that extracted code from an oversized file had to
	// edit the allowlist before its work could pass, punishing the change the ceiling wants.
	const shrunk = assessFile('src/legacy.js', 700, config);
	assert.equal(shrunk.status, 'slack');
	assert.match(describeAssessment('src/legacy.js', shrunk), /check:size:tighten.*200 recovered lines/u);

	const under = assessFile('src/legacy.js', 400, config);
	assert.equal(under.status, 'exception-obsolete');
	assert.match(describeAssessment('src/legacy.js', under), /back under the 600-line limit/u);
});

test('the warning band opens below the ceiling and closes at it', () => {
	assert.equal(assessFile('src/new.ts', 549, config).status, 'ok');
	assert.equal(assessFile('src/new.ts', 550, config).status, 'near-ceiling');
	assert.equal(assessFile('src/new.ts', 600, config).status, 'near-ceiling');
	assert.equal(describeAssessment('src/new.ts', assessFile('src/new.ts', 600, config)),
		'src/new.ts: 600 lines, exactly on the 600-line limit.');
	assert.equal(describeAssessment('src/new.ts', assessFile('src/new.ts', 400, config)), null);
});

test('an allowlist entry without a reason is rejected', () => {
	const bare = { ...config, allow: { 'src/legacy.js': { maxLines: 900 } } };
	assert.equal(assessFile('src/legacy.js', 700, bare).status, 'invalid-exception');
});

test('the checked-in configuration declares a warning band under the ceiling', () => {
	const live = loadMaintainabilityConfig(new URL('..', import.meta.url).pathname);
	assert.ok(live.warnLines < live.defaultMaxLines, 'the band must leave room to act in');
	assert.ok(live.warnLines >= 1);
});

test('the edit hook advises only on maintained sources near their ceiling', () => {
	const read = (lines) => () => 'x\n'.repeat(lines);
	assert.equal(headroomAdvice('src/new.ts', read(400)), null);
	assert.equal(headroomAdvice('docs/plan.md', read(900)), null, 'documentation carries no ceiling');
	assert.equal(headroomAdvice('../outside.ts', read(900)), null, 'paths outside the repository are ignored');
	assert.match(headroomAdvice('src/new.ts', read(575)), /575 lines, 25 below the 600-line/u);
	assert.match(headroomAdvice('src/new.ts', read(600)), /exactly on the 600-line/u);
	assert.match(headroomAdvice('src/new.ts', read(640)), /passed the 600-line maintainability ceiling/u);
});

test('the hook speaks the PostToolUse payload shape', () => {
	assert.deepEqual(hookOutput('advice'), {
		hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'advice' },
	});
});
