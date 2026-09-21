/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const timelineDirectory = new URL('../src/common/editor/ui/timeline/', import.meta.url);

test('annotation layer and panel share one interaction lifecycle authority', () => {
	const shared = source('useTimelineAnnotationInteractions.js');
	const consumers = [
		source('TimelineAnnotationLayer.jsx'),
		source('TimelineAnnotationPanel.jsx'),
	];

	for (const consumer of consumers) {
		assert.match(consumer, /useTimelineAnnotationInteractions\(/u);
		assert.equal(consumer.match(/useTimelineAnnotationInteractions\(/gu)?.length, 1);
		for (const authority of [
			'createTimelineAnnotationUiModel',
			'consumeTimelineAnnotationRenameKey',
			'resolveTimelineAnnotationKeyboardIntent',
			'timelineAnnotationPointerSelectionIds',
		]) assert.doesNotMatch(consumer, new RegExp(`\\b${authority}\\b`, 'u'), authority);
	}

	for (const authority of [
		'createTimelineAnnotationUiModel',
		'consumeTimelineAnnotationRenameKey',
		'resolveTimelineAnnotationKeyboardIntent',
		'timelineAnnotationPointerSelectionIds',
	]) assert.match(shared, new RegExp(`\\b${authority}\\b`, 'u'), authority);
});

function source(fileName: string): string {
	return readFileSync(new URL(fileName, timelineDirectory), 'utf8');
}
