/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import NativePreferencesPanel from '../src/common/editor/ui/dialogs/NativePreferencesPanel.tsx';
import type { AssistanceMenuEntry } from '../src/common/editor/ui/assistance-task-catalog.ts';
import { organizeNativePreferences } from '../src/common/editor/ui/local-processing-menus.ts';
import { appendParallelStackProcessingMenu, type ParallelStackMenuItem } from '../src/common/editor/ui/parallel-stack-menu.ts';

function render(blocked: boolean, section = 'audio', liveBlocked = blocked): string {
	const items = appendParallelStackProcessingMenu([], {
		productId: 'soundscaper', blocked, isBlocked: () => liveBlocked,
		preferences: { enabled: true, workerLimit: 2, pipelineFrames: 1536 },
		status: { state: 'unsupported', reason: 'Unsupported rack', sampleRate: 48000 },
	}, () => undefined);
	const adapt = (item: ParallelStackMenuItem): AssistanceMenuEntry => ({ ...item, items: item.items?.map(adapt) });
	return renderToStaticMarkup(<NativePreferencesPanel
		menus={organizeNativePreferences([{ id: 'tools', items: items.map(adapt) }])}
		section={section} copy={{}} onNavigate={() => undefined}
	/>);
}

test('Audio preferences renders processing settings and fallback status without a navigation button', () => {
	const markup = render(false);
	assert.match(markup, /<legend>Processing<\/legend>/u);
	assert.match(markup, /role="checkbox"[^>]*aria-checked="true"[^>]*aria-label="Parallel effect stacks"/u);
	assert.match(markup, /Worker limit/u);
	assert.match(markup, /<option value="parallel-stack-workers-2" selected="">2 workers<\/option>/u);
	assert.match(markup, /<option value="parallel-stack-buffering-1536" selected="">Recommended<\/option>/u);
	assert.match(markup, /Added latency: 32 ms at 48000 Hz/u);
	assert.match(markup, /Using standard processing: Unsupported rack/u);
	assert.doesNotMatch(markup, /<button/u);
	assert.equal(render(false, 'effects'), '');
});

test('Audio preferences disables processing changes during playback and explains why', () => {
	const markup = render(true);
	assert.match(markup, /role="checkbox"[^>]*aria-disabled="true"/u);
	assert.equal([...markup.matchAll(/<select\b[^>]*disabled=""/gu)].length, 2);
	assert.match(markup, /Stop playback and recording to change processing settings\./u);
	assert.match(markup, /Using standard processing: Unsupported rack/u);
});

test('processing preferences resolves playback restrictions when the preferences opens', () => {
	assert.match(render(false, 'audio', true), /role="checkbox"[^>]*aria-disabled="true"/u);
	assert.doesNotMatch(render(true, 'audio', false), /aria-disabled="true"|<select disabled/u);
});
