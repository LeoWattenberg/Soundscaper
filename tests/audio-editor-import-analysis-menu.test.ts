/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImportAnalysisToolMenuItems,
	createRepeatAnalyzerMenuItem,
	createRepeatGeneratorMenuItem,
} from '../src/common/editor/ui/import-analysis-application-menu.ts';

test('import and analysis application-menu items expose only opted-in workflows', () => {
	const issued: string[] = [];
	const context = {
		productId: 'soundscaper',
		copy: {
			repeatLastGenerator: 'Repeat generator', repeatLastAnalyzer: 'Repeat analyzer',
			audacityParityLabelImportRawData: 'Import raw data', regularIntervalLabels: 'Regular interval labels',
		},
		snapshot: { analysisRepeatable: true, generators: { canRepeatLast: true } },
		editBlocked: false, blocked: false, analyzerBlocked: false,
		actionRuntime: {
			generators: { repeatLast: () => { issued.push('generator'); } },
			analysis: { repeatLast: () => { issued.push('analyzer'); } },
			io: { importRawData: () => { issued.push('raw'); } },
			timelineAnnotations: { openRegularInterval: () => { issued.push('regular'); } },
		},
	};
	const items = [
		createRepeatGeneratorMenuItem(context),
		createRepeatAnalyzerMenuItem(context),
		...createImportAnalysisToolMenuItems(context),
	];
	assert.deepEqual(items.map(({ id, disabled }) => [id, disabled]), [
		['repeat-generator', false], ['repeat-analyzer', false], ['raw-data-import', false], ['regular-interval-labels', false],
	]);
	for (const item of items) item.onClick();
	assert.deepEqual(issued, ['generator', 'analyzer', 'raw', 'regular']);
	assert.deepEqual(createImportAnalysisToolMenuItems({ ...context, productId: 'framescaper' }), []);
});
