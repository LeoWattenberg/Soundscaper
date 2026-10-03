/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistanceProcessingProgress from '../src/common/editor/ui/dialogs/AssistanceProcessingProgress.tsx';
import LocalAssistanceGuidedPanel from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedPanel.tsx';
import { INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT } from '../src/common/editor/ui/local-assistance-guided-session-store.ts';

test('runtime startup shows indeterminate progress until real counts arrive', () => {
	for (const progress of [null, { completed: null, total: null }, { completed: 0, total: 0 }]) {
		const markup = renderToStaticMarkup(<AssistanceProcessingProgress label="Processing status" progress={progress} />);
		assert.match(markup, /<progress aria-label="Processing status"/u);
		assert.doesNotMatch(markup, /<progress[^>]*value=/u);
	}
	const measured = renderToStaticMarkup(<AssistanceProcessingProgress label="Processing status"
		progress={{ completed: 3, total: 10 }} />);
	assert.match(measured, /<progress[^>]*value="3" max="10"/u);
});

test('the effect keeps its loading bar visible during preparation and native startup', () => {
	for (const phase of ['preparing', 'running'] as const) {
		const markup = renderToStaticMarkup(<LocalAssistanceGuidedPanel copy={{}} focusedTask
			snapshot={{ ...INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT, phase }}
			onSelectWorkflow={() => undefined} onSettingsChange={() => undefined}
			onRun={() => undefined} onCancel={() => undefined} onReview={() => undefined}
			onAccept={() => undefined} onChoiceChange={() => undefined}
			onReframeCropChange={() => undefined} onHighlightTitleChange={() => undefined}
			onHighlightTrimChange={() => undefined} onHighlightCropChange={() => undefined} />);
		assert.match(markup, /<progress[^>]*aria-label="Processing status"/u);
	}
});
