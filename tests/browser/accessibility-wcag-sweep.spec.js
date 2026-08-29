/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import accessibilityBaseline from '../../config/accessibility-wcag-baseline.json' with { type: 'json' };
import { AxeBuilder, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { settleFiniteAnimations } from './helpers/settle-finite-animations.js';

// Milestone 9 owes a recorded accessibility position, and the per-feature axe
// assertions scattered through the suite cannot give one: they cover the dialog
// each spec happens to open, run untagged, and never see 200% reflow, forced
// colors, or reduced motion. This sweep walks the maintained routes under each
// of those conditions with the WCAG 2.2 AA tag set and publishes one count.
const WCAG_TAGS = Object.freeze(accessibilityBaseline.tags);
const BLOCKING_IMPACTS = Object.freeze(accessibilityBaseline.impacts);
const ROUTES = Object.freeze([
	{ id: 'soundscaper', path: '/en/' },
	{ id: 'framescaper', path: '/framescaper/en/' },
]);
const CONDITIONS = Object.freeze([
	{ id: 'default', viewport: { width: 1_280, height: 800 }, media: {} },
	// 200% zoom is expressed as half the CSS viewport at the same device pixels,
	// which is what the reflow criterion actually measures.
	{ id: 'zoom-200', viewport: { width: 640, height: 400 }, media: {} },
	{ id: 'forced-colors', viewport: { width: 1_280, height: 800 }, media: { forcedColors: 'active' } },
	{ id: 'reduced-motion', viewport: { width: 1_280, height: 800 }, media: { reducedMotion: 'reduce' } },
]);

test('the maintained routes match the recorded WCAG 2.2 AA baseline', async ({ page, browserName }) => {
	// Computed style, layout rounding and the accessibility tree all differ by
	// engine, so one recorded baseline can only describe one of them. Chromium
	// carries it; Firefox and WebKit keep their own per-feature axe assertions.
	test.skip(browserName !== 'chromium', 'The recorded baseline is measured on Chromium.');
	test.setTimeout(300_000);
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));

	const sweeps = [];
	for (const route of ROUTES) {
		for (const condition of CONDITIONS) {
			await page.setViewportSize(condition.viewport);
			await page.emulateMedia(condition.media);
			await bootEditor(page, route.path);
			await settleFiniteAnimations(page);
			const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
			sweeps.push({
				routeId: route.id,
				conditionId: condition.id,
				passes: results.passes.length,
				incomplete: results.incomplete.length,
				violations: results.violations.map((violation) => ({
					id: violation.id,
					impact: violation.impact,
					tags: violation.tags.filter((tag) => WCAG_TAGS.includes(tag)),
					nodes: violation.nodes.length,
					targets: violation.nodes.map((node) => node.target),
				})),
			});
		}
	}
	await page.emulateMedia({ forcedColors: null, reducedMotion: null });

	const diagnostic = {
		schemaVersion: 1,
		workloadId: 'm9-wcag-2-2-aa-sweep',
		tags: WCAG_TAGS,
		routeCount: ROUTES.length,
		conditionCount: CONDITIONS.length,
		blockingViolations: sweeps.reduce((total, sweep) => total + sweep.violations
			.filter(({ impact }) => BLOCKING_IMPACTS.includes(impact)).length, 0),
		otherViolations: sweeps.reduce((total, sweep) => total + sweep.violations
			.filter(({ impact }) => !BLOCKING_IMPACTS.includes(impact)).length, 0),
		sweeps,
	};
	console.log(`SOUNDSCAPER_WCAG_SWEEP ${JSON.stringify(diagnostic)}`);

	// A ratchet rather than a bar the routes do not clear yet: a new violation
	// fails, and so does a cleared one, because a baseline nobody prunes stops
	// meaning anything. Each known row carries the reason it is still open.
	const observed = sweeps.flatMap(({ routeId, conditionId, violations }) => violations
		.filter(({ impact }) => BLOCKING_IMPACTS.includes(impact))
		.map(({ id, nodes }) => ({ routeId, conditionId, ruleId: id, nodes })))
		.sort(compareRows);
	const known = accessibilityBaseline.known
		.map(({ routeId, conditionId, ruleId, nodes }) => ({ routeId, conditionId, ruleId, nodes }))
		.sort(compareRows);
	expect(observed, 'config/accessibility-wcag-baseline.json must record exactly what the routes fail')
		.toEqual(known);
});

function compareRows(left, right) {
	return `${left.routeId}/${left.conditionId}/${left.ruleId}`
		.localeCompare(`${right.routeId}/${right.conditionId}/${right.ruleId}`);
}
