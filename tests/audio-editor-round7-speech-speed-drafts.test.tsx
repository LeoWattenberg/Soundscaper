/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import TextToSpeechDialog from '../src/common/editor/ui/dialogs/TextToSpeechDialog.tsx';
import type { TextToSpeechPort, TextToSpeechRequest } from '../src/common/editor/ui/text-to-speech-port.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Text to Speech preserves a fractional speed draft and generates with the completed value', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const requests: TextToSpeechRequest[] = [];
	const port: TextToSpeechPort = {
		load: async () => ({ installed: true, voices: [{ id: 'af_heart', label: 'af_heart', language: 'a' }],
			initial: { text: 'Ordinary narration', language: 'a', voiceId: 'af_heart', speed: 1 }, placement: 'new-track' }),
		generate: (request) => { requests.push(request); return Promise.reject(new Error('No output requested by this test')); },
		accept: async () => undefined,
	};
	try {
		await act(async () => root.render(<TextToSpeechDialog port={port} modelBridge={null}
			copy={{}} locale="en" onClose={() => undefined} />));
		const speed = dom.container.querySelectorAll('input')[0]!;
		assert.ok(speed);
		for (const value of ['', '0', '0.75']) {
			await act(async () => reactProps(speed).onChange({ currentTarget: { value } }));
			assert.equal(speed.value, value, 'the unfinished decimal remains editable');
		}
		await act(async () => reactProps(speed).onBlur());
		const generate = dom.container.querySelectorAll('button').find(button => button.textContent === 'Generate preview')!;
		assert.equal(generate.disabled, false);
		await act(async () => reactProps(generate).onClick());
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.speed, 0.75);
		await act(async () => reactProps(speed).onChange({ currentTarget: { value: '3' } }));
		await act(async () => reactProps(speed).onBlur());
		assert.equal(speed.value, '0.75', 'invalid completed speed restores the last accepted value');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
