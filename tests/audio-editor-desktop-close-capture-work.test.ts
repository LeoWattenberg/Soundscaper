/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	editorCloseHasActiveWork,
	sealEditorCaptureForClose,
} from '../src/common/editor/ui/workspace/desktop-editor-close-work.ts';
import { desktopActiveWorkQuitPrompt } from '../src/common/editor/ui/workspace/useDesktopEditorBridge.js';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('desktop close recognizes unsealed 8A/Web VCR work but not durable recovery', () => {
	assert.equal(editorCloseHasActiveWork({ capture: { phase: 'recording' } }), true);
	assert.equal(editorCloseHasActiveWork({ webVcr: { modeActive: true, phase: 'preparing' } }), true);
	assert.equal(editorCloseHasActiveWork({ capture: { phase: 'recovery' }, webVcr: { modeActive: true, phase: 'recovery' } }), false);
	assert.equal(editorCloseHasActiveWork({ capture: { phase: 'previewing' }, webVcr: { modeActive: true, phase: 'ready' } }), false);
});

test('desktop close awaits capture sealing before it may flush', async () => {
	const events: string[] = [];
	await sealEditorCaptureForClose({ actions: { capture: {
		async sealForShutdown() { await Promise.resolve(); events.push('sealed'); },
	} } });
	events.push('flush');
	assert.deepEqual(events, ['sealed', 'flush']);
});

test('desktop active-work close copy is localized and names the current product', () => {
	assert.equal(desktopActiveWorkQuitPrompt({
		...ENGLISH_COPY, title: ENGLISH_COPY.framescaperTitle,
	}), 'Framescaper is still recording or processing. Stop the active work and quit?');
	assert.equal(desktopActiveWorkQuitPrompt({
		...GERMAN_COPY, title: GERMAN_COPY.framescaperTitle,
	}), 'Framescaper nimmt noch auf oder verarbeitet Daten. Aktive Arbeit stoppen und beenden?');
});
