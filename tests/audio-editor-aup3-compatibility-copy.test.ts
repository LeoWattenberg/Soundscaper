/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityCompatibilityDescription,
	audacityCompatibilityTitle,
	formatAup4CompatibilitySummary,
} from '../src/common/editor/ui/dialogs/editor-dialog-model.js';
import { REPORT_COPY_BY_LOCALE } from '../src/common/i18n/report-copy.js';

test('AUP3 export compatibility surfaces identify the selected generation', () => {
	const copy = REPORT_COPY_BY_LOCALE.en;
	const report = {
		format: 'audacity-project',
		targetGeneration: 'aup3',
		direction: 'save',
		items: [],
		counts: { preserved: 0, converted: 1, missing: 0, omitted: 2 },
	};

	assert.equal(audacityCompatibilityTitle(report, copy), 'AUP3 Compatibility Report');
	assert.match(audacityCompatibilityDescription(report, copy), /^AUP3 is an Audacity 3 project format/u);
	assert.equal(formatAup4CompatibilitySummary(report, copy), 'AUP3 export: 1 converted, 0 missing, 2 omitted.');
});

test('AUP3 open compatibility surfaces identify the source generation', () => {
	const copy = REPORT_COPY_BY_LOCALE.en;
	const report = {
		format: 'audacity-project',
		sourceGeneration: 'aup3',
		direction: 'open',
		items: [],
		counts: { preserved: 0, converted: 2, missing: 1, omitted: 0 },
	};

	assert.equal(audacityCompatibilityTitle(report, copy), 'AUP3 Compatibility Report');
	assert.match(audacityCompatibilityDescription(report, copy), /^AUP3 is an Audacity 3 project format/u);
	assert.equal(formatAup4CompatibilitySummary(report, copy), 'AUP3 open: 2 converted, 1 missing, 0 omitted.');
});
