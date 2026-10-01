/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopNightlyTestsProgressBar,
	validateDesktopNightlyTestsProgress,
} from '../scripts/lib/desktop-nightly-tests-presentation.mjs';
import {
	createDesktopNightlyTestsProgressUpdateSource,
	validateDesktopNightlyTestsProgressUpdateSource,
} from '../desktop/nightly-tests-progress-window.mjs';

const progress = {
	completed: 0, total: 6, label: 'Browser tests',
	items: { completed: 3, total: 10, label: '[chromium] editor opens <project>\u2028' },
};

test('nightly progress transports item counts through the closed renderer recipe', () => {
	const source = createDesktopNightlyTestsProgressUpdateSource(progress);
	assert.deepEqual(validateDesktopNightlyTestsProgressUpdateSource(source), progress);
	assert.doesNotMatch(source, /<project>/u);
	assert.match(source, /\\u003cproject>/u);
	assert.match(source, /\\u2028/u);
	assert.throws(() => createDesktopNightlyTestsProgressUpdateSource({
		...progress, items: { ...progress.items, sourceURL: 'https://unexpected.invalid/' },
	}), /closed record/u);
});

test('nightly progress validates item counters and permits an empty discovered suite', () => {
	assert.equal(validateDesktopNightlyTestsProgress({
		...progress, items: { completed: 0, total: 0, label: 'No tests' },
	}).items.total, 0);
	for (const items of [
		null, [], {},
		{ completed: -1, total: 10, label: 'Test' },
		{ completed: 11, total: 10, label: 'Test' },
		{ completed: 0.5, total: 10, label: 'Test' },
		{ completed: 0, total: -1, label: 'Test' },
		{ completed: 0, total: 10, label: '' },
		{ completed: 0, total: 10, label: 'Test\nforged progress' },
	]) {
		assert.throws(() => validateDesktopNightlyTestsProgress({ ...progress, items }), /progress/iu);
	}
});

test('nightly terminal progress advances within a phase and names its test', () => {
	const writes: string[] = [];
	const bar = createDesktopNightlyTestsProgressBar({
		output: { write: (value: string) => { writes.push(value); } },
	});
	bar.update({ ...progress, items: { ...progress.items, label: '[chromium] editor opens' } });
	bar.finish({ completed: 6, total: 6, label: 'Tests passed', items: progress.items });
	assert.deepEqual(writes, [
		'[#-------------------] 0/6 5% Browser tests — 3/10 tests: [chromium] editor opens\n',
		'[####################] 6/6 100% Tests passed\n',
	]);
});
