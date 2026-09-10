/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assessFile,
	ceilingFor,
	compareMaintainabilityConfigs,
	describeAssessment,
	describeMaintainedFileGrowth,
	FAILING_STATUSES,
	loadMaintainabilityConfig,
	planMaintainabilityTightening,
	tightenMaintainabilityConfig,
	validateMaintainabilityConfig,
} from '../scripts/lib/maintainability-ceiling.mjs';
import { headroomAdvice, hookOutput } from '../scripts/hooks/report-maintainability-headroom.mjs';

const config = {
	schemaVersion: 2,
	defaultMaxLines: 600,
	browserSpecMaxLines: 800,
	warnLines: 550,
	warningBandRatchets: {
		'src/crowded.ts': 575,
		'tests/browser/crowded.spec.js': 694,
	},
	allow: {
		'src/legacy.js': { maxLines: 900, reason: 'Legacy module awaiting extraction.' },
	},
};

test('browser specs get their own ceiling', () => {
	assert.equal(ceilingFor('tests/browser/timeline.spec.js', config), 800);
	assert.equal(ceilingFor('tests/timeline.test.js', config), 600);
	assert.equal(ceilingFor('src/common/editor/export.js', config), 600);
});

test('growth past a ceiling or a checked-in ratchet fails', () => {
	assert.equal(assessFile('src/new.ts', 601, config).status, 'over-ceiling');
	assert.equal(assessFile('src/legacy.js', 901, config).status, 'over-ratchet');
	assert.equal(assessFile('src/crowded.ts', 576, config).status, 'over-warning-ratchet');
	assert.equal(assessFile('src/untracked.ts', 550, config).status, 'unratcheted-warning-band');
	for (const status of ['over-ceiling', 'over-ratchet', 'over-warning-ratchet', 'unratcheted-warning-band']) {
		assert.ok(FAILING_STATUSES.includes(status));
	}
	for (const status of [
		'ok',
		'at-warning-ratchet',
		'warning-ratchet-slack',
		'warning-ratchet-obsolete',
		'slack',
		'exception-obsolete',
		'at-ratchet',
	]) {
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

test('the warning band requires a baseline and freezes a file at that baseline', () => {
	assert.equal(assessFile('src/new.ts', 549, config).status, 'ok');
	assert.equal(assessFile('src/new.ts', 550, config).status, 'unratcheted-warning-band');
	assert.equal(assessFile('src/crowded.ts', 575, config).status, 'at-warning-ratchet');
	assert.equal(describeAssessment('src/crowded.ts', assessFile('src/crowded.ts', 575, config)),
		'src/crowded.ts: 575 lines at its warning-band ratchet; any growth fails.');
	assert.equal(describeAssessment('src/new.ts', assessFile('src/new.ts', 400, config)), null);
});

test('a warning-band file may shrink and check:size:tighten claims the recovery', () => {
	const shrunk = assessFile('src/crowded.ts', 560, config);
	assert.equal(shrunk.status, 'warning-ratchet-slack');
	assert.match(describeAssessment('src/crowded.ts', shrunk), /check:size:tighten.*15 recovered lines/u);

	const under = assessFile('src/crowded.ts', 549, config);
	assert.equal(under.status, 'warning-ratchet-obsolete');
	assert.match(describeAssessment('src/crowded.ts', under), /below the 550-line warning band/u);
});

test('tightening lowers or removes warning-band ratchets without mutating the input', () => {
	const lowered = tightenMaintainabilityConfig(
		config,
		new Map(),
		new Map([['src/crowded.ts', 560]]),
	);
	assert.equal(lowered.warningBandRatchets['src/crowded.ts'], 560);
	assert.equal(config.warningBandRatchets['src/crowded.ts'], 575);

	const removed = tightenMaintainabilityConfig(
		config,
		new Map(),
		new Map([['src/crowded.ts', null]]),
	);
	assert.equal(Object.hasOwn(removed.warningBandRatchets, 'src/crowded.ts'), false);
});

test('tightening migrates an obsolete size exception into the warning-band ratchet', () => {
	const assessment = assessFile('src/legacy.js', 575, config);
	assert.equal(assessment.status, 'exception-obsolete');
	assert.ok(!FAILING_STATUSES.includes(assessment.status));
	const plan = planMaintainabilityTightening(assessment, config);
	assert.deepEqual(plan, {
		allow: null,
		warningBand: 575,
	});
	const migrated = tightenMaintainabilityConfig(
		config,
		new Map([['src/legacy.js', plan.allow]]),
		new Map([['src/legacy.js', plan.warningBand]]),
	);
	assert.equal(Object.hasOwn(migrated.allow, 'src/legacy.js'), false);
	assert.equal(migrated.warningBandRatchets['src/legacy.js'], 575);
	assert.equal(assessFile('src/legacy.js', 575, migrated).status, 'at-warning-ratchet');
});

test('tightening writes both policy maps in canonical path order', () => {
	const unordered = {
		...config,
		warningBandRatchets: {
			'z-last.ts': 560,
			'a-first.ts': 550,
		},
		allow: {
			'z-last.ts': { maxLines: 900, reason: 'Last.' },
			'a-first.ts': { maxLines: 700, reason: 'First.' },
		},
	};
	const tightened = tightenMaintainabilityConfig(unordered, new Map(), new Map());
	assert.deepEqual(Object.keys(tightened.warningBandRatchets), ['a-first.ts', 'z-last.ts']);
	assert.deepEqual(Object.keys(tightened.allow), ['a-first.ts', 'z-last.ts']);
});

test('schema validation keeps the warning band below both ceilings and validates exceptions', () => {
	const minimal = { ...config, warningBandRatchets: {} };
	assert.throws(
		() => validateMaintainabilityConfig({ ...minimal, warnLines: 600 }),
		/Unsupported maintainability allowlist schema/u,
	);
	assert.throws(
		() => validateMaintainabilityConfig({ ...minimal, browserSpecMaxLines: 500 }),
		/Unsupported maintainability allowlist schema/u,
	);
	assert.throws(
		() => validateMaintainabilityConfig({ ...minimal, allow: { 'src/legacy.js': null } }),
		/Invalid size exception/u,
	);
	assert.throws(
		() => validateMaintainabilityConfig({
			...minimal,
			allow: { 'src/legacy.js': { maxLines: 600, reason: 'Not actually over its ceiling.' } },
		}),
		/Invalid size exception/u,
	);
});

test('checked-in ratchets may tighten or follow a rename but cannot be added or raised', () => {
	const raised = structuredClone(config);
	raised.warningBandRatchets['src/crowded.ts'] = 576;
	assert.match(compareMaintainabilityConfigs(raised, config)[0], /raised from 575 to 576/u);

	const added = structuredClone(config);
	added.warningBandRatchets['src/new.ts'] = 550;
	assert.match(compareMaintainabilityConfigs(added, config)[0], /new warning-band ratchet/u);

	const tightened = structuredClone(config);
	tightened.warningBandRatchets['src/crowded.ts'] = 560;
	assert.deepEqual(compareMaintainabilityConfigs(tightened, config), []);

	const renamed = structuredClone(config);
	delete renamed.warningBandRatchets['src/crowded.ts'];
	renamed.warningBandRatchets['src/domain/crowded.ts'] = 575;
	assert.deepEqual(compareMaintainabilityConfigs(
		renamed,
		config,
		new Map([['src/domain/crowded.ts', 'src/crowded.ts']]),
	), []);
});

test('checked-in policy and legacy size exceptions cannot be loosened', () => {
	const threshold = structuredClone(config);
	threshold.warnLines = 551;
	assert.match(compareMaintainabilityConfigs(threshold, config)[0], /warning threshold increased/iu);

	const ceiling = structuredClone(config);
	ceiling.browserSpecMaxLines = 801;
	assert.match(compareMaintainabilityConfigs(ceiling, config)[0], /browser-spec ceiling increased/iu);

	const raised = structuredClone(config);
	raised.allow['src/legacy.js'].maxLines = 901;
	assert.match(compareMaintainabilityConfigs(raised, config)[0], /size exception.*raised/u);

	const added = structuredClone(config);
	added.allow['src/new-legacy.js'] = { maxLines: 700, reason: 'New exception.' };
	assert.match(compareMaintainabilityConfigs(added, config)[0], /new size exception/u);
});

test('schema-v1 bootstrap keeps ceilings and exceptions monotonic and seeds exact sizes', () => {
	const legacy = {
		schemaVersion: 1,
		defaultMaxLines: 600,
		browserSpecMaxLines: 800,
		warnLines: 550,
		allow: config.allow,
	};
	assert.deepEqual(compareMaintainabilityConfigs(
		config,
		legacy,
		new Map(),
		new Map([
			['src/crowded.ts', 575],
			['tests/browser/crowded.spec.js', 694],
		]),
	), []);

	const looseCeiling = structuredClone(config);
	looseCeiling.defaultMaxLines = 601;
	assert.match(compareMaintainabilityConfigs(looseCeiling, legacy)[0], /ceiling increased/u);

	const looseException = structuredClone(config);
	looseException.allow['src/legacy.js'].maxLines = 901;
	assert.match(compareMaintainabilityConfigs(looseException, legacy)[0], /size exception.*raised/u);

	assert.match(
		compareMaintainabilityConfigs(config, legacy, new Map(), new Map())[0],
		/initial warning-band ratchet must equal its current line count/u,
	);
});

test('warning-band source growth is compared to its actual Git-base size', () => {
	assert.equal(describeMaintainedFileGrowth('src/crowded.ts', 575, 575, 550), null);
	assert.equal(describeMaintainedFileGrowth('src/crowded.ts', 560, 575, 550), null);
	assert.equal(describeMaintainedFileGrowth('src/crowded.ts', 549, 548, 550), null);
	assert.match(
		describeMaintainedFileGrowth('src/crowded.ts', 576, 575, 550),
		/grew from 575 to 576 lines/u,
	);
	assert.match(
		describeMaintainedFileGrowth('src/new.ts', 550, null, 550),
		/no predecessor/u,
	);
});

test('browser specs retain their higher ceiling while growth-freezing their warning baseline', () => {
	assert.equal(assessFile('tests/browser/crowded.spec.js', 694, config).status, 'at-warning-ratchet');
	assert.equal(assessFile('tests/browser/crowded.spec.js', 695, config).status, 'over-warning-ratchet');
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
	const loadConfig = () => config;
	assert.equal(headroomAdvice('src/new.ts', read(400), loadConfig), null);
	assert.equal(headroomAdvice('docs/plan.md', read(900)), null, 'documentation carries no ceiling');
	assert.equal(headroomAdvice('../outside.ts', read(900)), null, 'paths outside the repository are ignored');
	assert.match(headroomAdvice('src/crowded.ts', read(575), loadConfig), /warning-band ratchet.*Any growth/u);
	assert.match(headroomAdvice('src/crowded.ts', read(576), loadConfig), /passed its warning-band ratchet of 575/u);
	assert.match(headroomAdvice('src/new.ts', read(550), loadConfig), /entered the warning band without a baseline/u);
	assert.match(headroomAdvice('src/new.ts', read(640), loadConfig), /passed the 600-line maintainability ceiling/u);
});

test('the hook speaks the PostToolUse payload shape', () => {
	assert.deepEqual(hookOutput('advice'), {
		hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'advice' },
	});
});
