/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextToSpeechDialog, { TextToSpeechDialogView } from '../src/common/editor/ui/dialogs/TextToSpeechDialog.tsx';
import type { TextToSpeechDialogState } from '../src/common/editor/ui/dialogs/TextToSpeechDialog.tsx';
import type { TextToSpeechPort, TextToSpeechReviewed } from '../src/common/editor/ui/text-to-speech-port.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const voices = Object.freeze([
	{ id: 'voice-a', label: 'American voice', language: 'a' },
	{ id: 'voice-f', label: 'French voice', language: 'f' },
]);
const ready: TextToSpeechDialogState = {
	phase: 'ready', installed: true, voices, text: 'Narration script',
	language: 'a', voiceId: 'voice-a', speed: 1, reviewed: null, error: null,
	placement: 'new-track',
};
const actions = {
	onClose: () => undefined, onManageModels: () => undefined,
	onTextChange: () => undefined, onLanguageChange: () => undefined,
	onVoiceChange: () => undefined, onSpeedChange: () => undefined,
	onGenerate: () => undefined, onCancel: () => undefined, onAccept: () => undefined,
};

function markup(state: TextToSpeechDialogState, previewUrl: string | null = null): string {
	return renderToStaticMarkup(<TextToSpeechDialogView copy={{}} state={state}
		previewUrl={previewUrl} {...actions} />);
}

test('script, language and compatible voice are editable before local generation', () => {
	const html = markup(ready);
	assert.match(html, /Text to Speech/);
	assert.match(html, /<textarea[^>]*>Narration script<\/textarea>/u);
	assert.match(html, /<option value="a" selected="">American English/u);
	assert.match(html, /<option value="voice-a" selected="">American voice/u);
	assert.doesNotMatch(html, /<option value="voice-f"/u);
	assert.match(html, /Generate preview/u);
	assert.doesNotMatch(html, /<audio/u);
});

test('no model or empty script cannot generate, and model manager remains reachable', () => {
	const missing = markup({ ...ready, installed: false, phase: 'ready' });
	assert.match(missing, /Install a speech model/u);
	assert.match(missing, /Manage Models/u);
	assert.match(missing, /disabled=""[^>]*>.*Generate preview/u);
	const empty = markup({ ...ready, text: '   ' });
	assert.match(empty, /disabled=""[^>]*>.*Generate preview/u);
});

test('generated speech requires an explicit preview acceptance', () => {
	const reviewed = {
		audio: new Blob(['RIFF'], { type: 'audio/wav' }),
		request: { text: 'Narration script', language: 'a', voiceId: 'voice-a', speed: 1 },
		modelId: 'kokoro-82m', modelVersion: '1', artifactSha256s: ['a'.repeat(64)],
	};
	const html = markup({ ...ready, phase: 'preview', reviewed }, 'blob:preview');
	assert.match(html, /<audio[^>]*controls=""[^>]*src="blob:preview"/u);
	assert.match(html, /Add as new track at playhead/u);
	assert.doesNotMatch(html, /Generate preview/u);
	assert.match(markup({ ...ready, phase: 'generating' }), /Cancel generation/u);
	const replacement = markup({ ...ready, placement: 'regenerate-selected', phase: 'preview', reviewed }, 'blob:preview');
	assert.match(replacement, /Replace selected speech clip/u);
	assert.doesNotMatch(replacement, /Add as new track at playhead/u);
});

test('selected-source draft loads, cancelled output stays unpublished, and reviewed output is accepted once', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const request = { text: 'Saved narration', language: 'a', voiceId: 'voice-a', speed: 1 };
	const reviewed: TextToSpeechReviewed = {
		audio: new Blob(['RIFF'], { type: 'audio/wav' }), request,
		modelId: 'kokoro-82m', modelVersion: '1', artifactSha256s: ['a'.repeat(64)],
	};
	const pending: Array<(value: TextToSpeechReviewed) => void> = [];
	const generatedSignals: AbortSignal[] = [];
	const accepted: TextToSpeechReviewed[] = [];
	const port: TextToSpeechPort = {
		load: async () => ({ installed: true, voices, initial: request, placement: 'regenerate-selected' }),
		generate: (_request, signal) => {
			generatedSignals.push(signal);
			return new Promise((resolve) => { pending.push(resolve); });
		},
		accept: async (result) => { accepted.push(result); },
	};
	try {
		await act(async () => {
			root.render(<TextToSpeechDialog port={port} modelBridge={null} copy={{}}
				locale="en" onClose={() => undefined} />);
			await Promise.resolve();
		});
		assert.equal(dom.one('textarea').value, 'Saved narration');
		await act(async () => { void reactProps(button(dom.container, 'Generate preview')).onClick({}); });
		assert.equal(pending.length, 1);
		await act(async () => { void reactProps(button(dom.container, 'Cancel generation')).onClick({}); });
		assert.equal(generatedSignals[0]?.aborted, true);
		await act(async () => { pending[0]?.(reviewed); await Promise.resolve(); });
		assert.equal(dom.find('audio'), null);
		await act(async () => { void reactProps(button(dom.container, 'Generate preview')).onClick({}); });
		await act(async () => { pending[1]?.(reviewed); await Promise.resolve(); });
		assert.ok(dom.find('audio'));
		assert.equal(accepted.length, 0);
		await act(async () => {
			const accept = reactProps(button(dom.container, 'Replace selected speech clip')).onClick;
			void accept({});
			void accept({});
			await Promise.resolve();
		});
		assert.deepEqual(accepted, [reviewed]);
		assert.match(dom.container.textContent, /Selected speech clip replaced/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function button(root: ReactTestElement, label: string): ReactTestElement {
	const found = root.querySelectorAll('button').find((candidate) => candidate.textContent === label);
	assert.ok(found, `Missing button ${label}`);
	return found;
}
