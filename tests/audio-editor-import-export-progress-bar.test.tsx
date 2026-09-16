/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

(globalThis as unknown as { React: unknown }).React = React;

function renderProgress(kind: 'import' | 'export' | null, value: number | null = null) {
	return renderToStaticMarkup(<AccessibleSelectionToolbar
		controller={{
			subscribeTelemetry: () => () => undefined,
			getTelemetrySnapshot: () => ({ taskProgress: kind ? { id: 'large-audio', kind, label: 'Reading audio', value } : null }),
		}}
		snapshot={{ selection: null, importing: kind === 'import', exporting: kind === 'export' }}
		copy={ENGLISH_COPY}
		statusMessage="Reading audio"
		statusState="info"
		durationFrames={0}
		disabled={false}
		showSelectionToolbar={false}
		showStatusbar={false}
		run={() => undefined}
	/>);
}

test('menu-started imports and exports remain visible with both optional status toolbars hidden', () => {
	for (const kind of ['import', 'export'] as const) {
		const markup = renderProgress(kind, 0.375);
		assert.match(markup, /role="progressbar"/u);
		assert.match(markup, /aria-label="Reading audio"/u);
		assert.match(markup, /aria-valuenow="38"/u);
		assert.match(markup, /width:38%/u);
	}
});

test('preflight shows an indeterminate bar and task completion removes all progress UI', () => {
	assert.match(renderProgress('import'), /data-indeterminate=""/u);
	assert.doesNotMatch(renderProgress('import'), /aria-valuenow/u);
	assert.doesNotMatch(renderProgress(null), /progressbar|task-progress/u);
});
