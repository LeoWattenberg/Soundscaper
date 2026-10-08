/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { mountSurveyApp, surveyAppOwner, SURVEY_APP_ROWS } from './helpers/lightscaper-survey-app-fixture.tsx';
import { deferred } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) test(`actual ${locale} App exposes Survey from View and reviews only its captured selection`, async () => {
	const fixture = surveyAppOwner(), mounted = await mountSurveyApp(fixture.factory, locale);
	try {
		assert.equal(fixture.opens(), 0); assert.equal(mounted.dom.find('canvas'), null); assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null);
		const menu = mounted.dom.one('[data-photo-survey-menu]'); assert.equal(menu.hasAttribute('disabled'), true);
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, mounted.copy.photoViewMenu);
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); assert.equal(menu.hasAttribute('disabled'), true);
		await mounted.photo('b', true); await mounted.photo('d', true); await mounted.click(menu);
		assert.ok(mounted.dom.find('[data-photo-survey-dialog]')); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 3);
		assert.deepEqual(fixture.previews.map(value => value.slice(0, 2)).sort(), [['a', 'fit-screen'], ['b', 'thumbnail'], ['d', 'thumbnail']]);
		assert.deepEqual(mounted.selected(), ['a', 'b', 'd']); assert.equal(fixture.opens(), 1);
		await mounted.key('a', 'Delete'); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 2);
		assert.deepEqual(mounted.selected(), ['a', 'b', 'd']); assert.deepEqual(fixture.writes, []);
		await mounted.key('b', 'Delete'); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 1);
		await mounted.key('d', 'Delete'); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 0);
		assert.ok(mounted.dom.find('[data-photo-survey-dialog]')); assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0);
		await mounted.menu(mounted.copy.photoSurveyRestore); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
		await mounted.menu(mounted.copy.photoCloseMetadata); assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null);
		assert.equal(mounted.dom.find('canvas'), null); assert.deepEqual(mounted.selected(), ['a', 'b', 'd']);
	} finally { await mounted.dispose(); }
});

test('Survey keyboard culls only the focused reviewed tile and preserves local removals across its own ACK', async () => {
	const fixture = surveyAppOwner(), mounted = await mountSurveyApp(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
		await mounted.click(mounted.dom.one('[data-photo-survey-menu]'));
		await mounted.key('a', 'Delete'); await mounted.key('b', '5'); assert.deepEqual(fixture.writes, [['b', { rating: 5 }]]);
		assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 2); assert.match(mounted.dom.one('[data-survey-photo="b"]').textContent, /Rating: 5/u);
		await mounted.key('b', 'ArrowRight'); await mounted.key('d', 'p'); assert.deepEqual(fixture.writes[1], ['d', { flag: 'pick' }]);
		await mounted.flush(() => { const select = mounted.dom.one('[data-survey-label="d"]'); reactProps(select).onChange?.({ currentTarget: { value: 'blue' } }); });
		assert.deepEqual(fixture.writes[2], ['d', { colorLabel: 'blue' }]); assert.equal(fixture.opens(), 1);
		await mounted.menu(mounted.copy.photoSurveyRestore); assert.equal(mounted.dom.container.querySelectorAll('[data-survey-photo]').length, 3);
		assert.deepEqual(mounted.selected(), ['a', 'b', 'd']);
	} finally { await mounted.dispose(); }
});

test('one owner joins held ordinary previews before Survey and restores the user’s preview choices after Close', async () => {
	const fixture = surveyAppOwner(), first = deferred<{ outcome: 'missing' }>(); let held = true;
	fixture.port.readPreview = async (id, tier, options) => {
		fixture.previews.push([id, tier, options?.signal]);
		if (held) { held = false; return first.promise; } return { outcome: 'missing' };
	};
	const mounted = await mountSurveyApp(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
		await mounted.menu(mounted.copy.photoShowThumbnails); assert.equal(fixture.previews.length, 1);
		await mounted.click(mounted.dom.one('[data-photo-survey-menu]')); assert.equal(fixture.previews.length, 1); assert.equal(fixture.previews[0]?.[2]?.aborted, true);
		await mounted.flush(() => { first.resolve({ outcome: 'missing' }); });
		assert.deepEqual(fixture.previews.slice(1).map(value => value.slice(0, 2)).sort(), [['a', 'fit-screen'], ['b', 'thumbnail'], ['d', 'thumbnail']]);
		await mounted.menu(mounted.copy.photoCloseMetadata); assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 4);
		assert.deepEqual(fixture.previews.slice(4).map(value => value.slice(0, 2)), SURVEY_APP_ROWS.map(value => [value.id, 'thumbnail']));
	} finally { first.resolve({ outcome: 'missing' }); await mounted.flush(); await mounted.dispose(); }
});

test('closing a held Survey save aborts its borrowed signal and late ACKs do not reopen the review', async () => {
	const saved = deferred<PhotoLibraryRowV1>(), fixture = surveyAppOwner();
	fixture.port.setRating = async (id, rating, options) => { fixture.writes.push([id, { rating }]); fixture.signals.push(options?.signal); return saved.promise; };
	const mounted = await mountSurveyApp(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		await mounted.click(mounted.dom.one('[data-photo-survey-menu]')); await mounted.key('a', '3');
		await mounted.key('a', '4'); assert.equal(fixture.writes.length, 1);
		await mounted.menu(mounted.copy.photoCloseMetadata); assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null); assert.equal(fixture.signals[0]?.aborted, true);
		await mounted.flush(() => { saved.resolve({ ...SURVEY_APP_ROWS[0]!, rating: 3 }); });
		assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null); assert.match(mounted.dom.one('[data-photo-id="a"]').textContent, /Rating: 3/u);
	} finally { saved.resolve(SURVEY_APP_ROWS[0]!); await mounted.flush(); await mounted.dispose(); }
});

for (const first of ['compare', 'survey'] as const) for (const sameGesture of [false, true]) {
	test(`${first} excludes a retained opposite review menu intent${sameGesture ? ' before React publication' : ''}`, async () => {
		const fixture = surveyAppOwner(), mounted = await mountSurveyApp(fixture.factory);
		try {
			await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
			const opposite = first === 'compare' ? 'survey' : 'compare';
			const firstButton = mounted.dom.one(`[data-photo-${first}-menu]`), other = mounted.dom.one(`[data-photo-${opposite}-menu]`);
			const start = reactProps(firstButton).onClick, stale = reactProps(other).onClick;
			if (sameGesture) await mounted.flush(() => { start?.({ currentTarget: firstButton }); stale?.({ currentTarget: other }); });
			else {
				await mounted.click(firstButton); assert.equal(other.hasAttribute('disabled'), true);
				await mounted.flush(() => { stale?.({ currentTarget: other }); });
			}
			assert.ok(mounted.dom.find(`[data-photo-${first}-dialog]`)); assert.equal(mounted.dom.find(`[data-photo-${opposite}-dialog]`), null);
			assert.equal(mounted.dom.container.querySelectorAll('canvas').length, first === 'compare' ? 2 : 3);
			assert.equal(fixture.previews.length, first === 'compare' ? 2 : 3); assert.equal(fixture.opens(), 1);
		} finally { await mounted.dispose(); }
	});
}

for (const first of ['compare', 'survey'] as const) test(`Close ${first} releases review admission for the opposite mode`, async () => {
	const fixture = surveyAppOwner(), mounted = await mountSurveyApp(fixture.factory);
	const next = first === 'compare' ? 'survey' : 'compare';
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
		await mounted.click(mounted.dom.one(`[data-photo-${first}-menu]`));
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1);
		await mounted.menu(mounted.copy.photoCloseMetadata);
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0);
		const nextMenu = mounted.dom.one(`[data-photo-${next}-menu]`); assert.equal(nextMenu.hasAttribute('disabled'), false);
		await mounted.click(nextMenu);
		assert.ok(mounted.dom.find(`[data-photo-${next}-dialog]`)); assert.equal(mounted.dom.find(`[data-photo-${first}-dialog]`), null);
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, next === 'compare' ? 2 : 3);
		assert.deepEqual(fixture.previews.slice(first === 'compare' ? 2 : 3).map(value => value.slice(0, 2)).sort(), next === 'compare'
			? [['a', 'fit-screen'], ['b', 'fit-screen']] : [['a', 'fit-screen'], ['b', 'thumbnail'], ['d', 'thumbnail']]);
		assert.deepEqual(mounted.selected(), ['a', 'b', 'd']); assert.deepEqual(fixture.writes, []); assert.equal(fixture.opens(), 1);
	} finally { await mounted.dispose(); }
});

test('Close keeps a held Survey save excluded until its durable ACK joins, then allows Compare', async () => {
	const fixture = surveyAppOwner(), held = deferred<void>(), saveEntered = deferred<void>();
	const save = fixture.port.setRating;
	fixture.port.setRating = async (...args) => { fixture.signals.push(args[2]?.signal); saveEntered.resolve(); await held.promise; return save(...args); };
	const mounted = await mountSurveyApp(fixture.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
		const compareMenu = mounted.dom.one('[data-photo-compare-menu]'), retained = reactProps(compareMenu).onClick;
		await mounted.click(mounted.dom.one('[data-photo-survey-menu]')); await mounted.key('a', '4'); await saveEntered.promise;
		await mounted.menu(mounted.copy.photoCloseMetadata);
		assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null); assert.equal(fixture.signals[0]?.aborted, true);
		assert.equal(compareMenu.hasAttribute('disabled'), true);
		await mounted.flush(() => { retained?.({ currentTarget: compareMenu }); });
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(fixture.previews.length, 3); assert.deepEqual(fixture.writes, []);
		await mounted.flush(() => { held.resolve(); });
		assert.deepEqual(fixture.writes, [['a', { rating: 4 }]]); assert.match(mounted.dom.one('[data-photo-id="a"]').textContent, /Rating: 4/u);
		assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null); assert.equal(compareMenu.hasAttribute('disabled'), false);
		await mounted.click(compareMenu); assert.ok(mounted.dom.find('[data-photo-compare-dialog]'));
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1); assert.equal(fixture.opens(), 1);
	} finally { held.resolve(); await mounted.flush(); await mounted.dispose(); }
});

test('factory retirement joins the held Survey preview and old Session close before current factory/read admission', async () => {
	const old = surveyAppOwner(), current = surveyAppOwner();
	const heldRead = deferred<{ outcome: 'missing' }>(), heldClose = deferred<void>(), closeEntered = deferred<void>();
	let active = 0, maximum = 0, oldSignal: AbortSignal | undefined;
	const reads: [string, string, string][] = [];
	old.port.readPreview = async (id, tier, options) => {
		reads.push(['old', id, tier]); oldSignal = options?.signal; active++; maximum = Math.max(maximum, active);
		try { return await heldRead.promise; } finally { active--; }
	};
	current.port.readPreview = async (id, tier) => {
		reads.push(['current', id, tier]); active++; maximum = Math.max(maximum, active);
		try { return await Promise.resolve({ outcome: 'missing' as const }); } finally { active--; }
	};
	old.port.close = async () => { closeEntered.resolve(); await heldRead.promise; await heldClose.promise; };
	const mounted = await mountSurveyApp(old.factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true); await mounted.photo('d', true);
		const menu = mounted.dom.one('[data-photo-survey-menu]'), staleMenu = reactProps(menu).onClick;
		await mounted.click(menu); assert.deepEqual(reads, [['old', 'a', 'fit-screen']]);
		const tile = mounted.dom.one('[data-survey-photo="a"]'), staleKey = reactProps(tile).onKeyDown;
		const staleRate = reactProps(mounted.dom.one('[data-survey-rating="a"]')).onChange;
		const invokeStale = () => {
			staleMenu?.({ currentTarget: menu }); staleKey?.({ key: '5', currentTarget: tile, target: tile, preventDefault() {} });
			staleRate?.({ currentTarget: { value: '4' } });
		};
		await mounted.replace(current.factory); await closeEntered.promise;
		assert.equal(oldSignal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 0);
		await mounted.flush(invokeStale); await mounted.menu(mounted.copy.photoFirstPage);
		assert.equal(current.opens(), 0); assert.deepEqual(old.writes, []); assert.deepEqual(current.writes, []); assert.equal(active, 1);
		await mounted.flush(() => { heldRead.resolve({ outcome: 'missing' }); });
		assert.equal(active, 0); assert.equal(current.opens(), 0); assert.deepEqual(reads, [['old', 'a', 'fit-screen']]);
		await mounted.flush(() => { heldClose.resolve(); });
		assert.equal(current.opens(), 1); assert.equal(old.opens(), 1); assert.equal(maximum, 1);
		await mounted.photo('a'); await mounted.photo('b', true); await mounted.click(mounted.dom.one('[data-photo-survey-menu]'));
		assert.deepEqual(reads.slice(1), [['current', 'a', 'fit-screen'], ['current', 'b', 'thumbnail']]);
		assert.equal(mounted.dom.container.querySelectorAll('canvas').length, 2);
		await mounted.flush(invokeStale); assert.deepEqual(old.writes, []); assert.deepEqual(current.writes, []);
		await mounted.key('a', '3'); assert.deepEqual(current.writes, [['a', { rating: 3 }]]);
		assert.equal(current.opens(), 1); assert.equal(maximum, 1);
	} finally { heldRead.resolve({ outcome: 'missing' }); heldClose.resolve(); await mounted.flush(); await mounted.dispose(); }
});

test('loader replacement retires Survey callbacks and joins the old Session before reusing the same factory', async () => {
	const old = surveyAppOwner(), current = surveyAppOwner(); let opens = 0, loaderCalls = 0;
	const heldRead = deferred<{ outcome: 'missing' }>(), heldClose = deferred<void>(), closeEntered = deferred<void>();
	let oldSignal: AbortSignal | undefined;
	old.port.readPreview = async (_id, _tier, options) => { oldSignal = options?.signal; return heldRead.promise; };
	old.port.close = async () => { closeEntered.resolve(); await heldRead.promise; await heldClose.promise; };
	const factory = async () => (++opens === 1 ? old.port : current.port);
	const mounted = await mountSurveyApp(factory);
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		const menu = mounted.dom.one('[data-photo-survey-menu]'), staleMenu = reactProps(menu).onClick;
		await mounted.click(menu); const staleRate = reactProps(mounted.dom.one('[data-survey-rating="a"]')).onChange;
		const invokeStale = () => { staleMenu?.({ currentTarget: menu }); staleRate?.({ currentTarget: { value: '5' } }); };
		await mounted.replaceLoader(async () => { loaderCalls++; throw new Error('Review must not load a backup runtime.'); });
		await closeEntered.promise; assert.equal(oldSignal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-survey-dialog]'), null);
		await mounted.flush(invokeStale); await mounted.menu(mounted.copy.photoFirstPage); assert.equal(opens, 1);
		await mounted.flush(() => { heldRead.resolve({ outcome: 'missing' }); }); assert.equal(opens, 1);
		await mounted.flush(() => { heldClose.resolve(); }); assert.equal(opens, 2);
		await mounted.photo('a'); await mounted.photo('b', true); await mounted.click(mounted.dom.one('[data-photo-survey-menu]'));
		await mounted.flush(invokeStale); assert.deepEqual(old.writes, []); assert.deepEqual(current.writes, []);
		await mounted.key('a', '2'); assert.deepEqual(current.writes, [['a', { rating: 2 }]]);
		assert.equal(opens, 2); assert.equal(loaderCalls, 0); assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').length, 1);
	} finally { heldRead.resolve({ outcome: 'missing' }); heldClose.resolve(); await mounted.flush(); await mounted.dispose(); }
});
