/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COVERAGE_SCOPES, analyzeCoverageSummary, classifyProductionCoveragePath, parseCoverageGateConfiguration } from '../scripts/lib/coverage-gates.mjs';

test('Motion-owned intent and UI have an independent production coverage scope', () => {
	for (const path of ['src/motionscaper/editor-project-store.ts', 'src/motionscaper/ui/MotionscaperEditorBootstrap.tsx']) assert.equal(classifyProductionCoveragePath(path), 'motionscaper');
	assert.equal(classifyProductionCoveragePath('src/common/editor/motion-audio-mixer.ts'), 'editor');
	assert.equal(classifyProductionCoveragePath('desktop/motionscaper-main.ts'), 'desktop');
	assert.equal(classifyProductionCoveragePath('src/framescaper/project.ts'), 'framescaper');
	assert.equal(classifyProductionCoveragePath('src/soundscaper/project.ts'), 'soundscaper');
	assert.equal(classifyProductionCoveragePath('src/motionscaper-other/project.ts'), null);
});

test('Motion scope requires its recorded union ratchet policy and refuses missing ownership', () => {
	const scope = COVERAGE_SCOPES.find(value => value.id === 'motionscaper'); assert.ok(scope);
	assert.match(scope.reason, /union/iu); assert.match(scope.reason, /ratchet/iu);
	assert.throws(() => parseCoverageGateConfiguration({ scopes: COVERAGE_SCOPES.filter(value => value.id !== 'motionscaper') }), /no floors for scope motionscaper/u);
	const summary = {
		'src/motionscaper/editor-project-store.ts': measured(5, 10),
		'src/motionscaper/editor-document-session.ts': measured(3, 10),
		'src/framescaper/project.ts': measured(100, 100),
	};
	const result = analyzeCoverageSummary(summary, '/workspace');
	assert.equal(result.failures.some(value => value.startsWith('Coverage reported unclassified')), false);
	const motion = result.scopes.find(value => value.id === 'motionscaper'); assert.ok(motion);
	assert.equal(motion.files, 2); assert.equal(motion.metrics.lines.covered, 8); assert.equal(motion.metrics.lines.total, 20);
	assert.equal(motion.metrics.lines.percentage, 40);
	const missing = analyzeCoverageSummary({}, '/workspace');
	assert.ok(missing.failures.includes('Motionscaper coverage reported no production files.'));
});

function measured(covered: number, total: number) {
	return Object.fromEntries(['lines', 'statements', 'branches', 'functions'].map(metric => [metric, { covered, total, skipped: 0, pct: 100 * covered / total }]));
}
