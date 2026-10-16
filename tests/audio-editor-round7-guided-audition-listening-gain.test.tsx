/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalAssistanceGuidedReviewedResult } from '../src/common/editor/assistance/local-assistance-guided-result-review.ts';
import { AudioEditorListeningGainContext } from '../src/common/editor/ui/audio-editor-listening-preview.tsx';
import LocalAssistanceGuidedReview from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedReview.tsx';
import { floatWave } from './helpers/float32-wave-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const initialGain of [1, 0]) test(`actual original and enhanced Guided auditions start at ${String(initialGain)} and preserve review through live and paused gain changes`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const bytes = new Uint8Array(floatWave(48_000, 1, new Uint8Array(new Float32Array([0, 0.1, -0.1, 0]).buffer)));
	const original = new Blob([bytes], { type: 'audio/wav' });
	const review: LocalAssistanceGuidedReviewedResult = {
		reviewVersion: 1, jobId: '01'.repeat(20), workflowId: 'enhance-dialogue',
		outputs: [{ stageId: 'enhance-dialogue', slotId: 'enhanced-audio',
			claim: { claimVersion: 1, direction: 'output', claimId: '03'.repeat(20), jobId: '01'.repeat(20),
				stageId: 'enhance-dialogue', slotId: 'enhanced-audio' },
			body: new Blob([bytes], { type: 'audio/wav' }), mediaType: 'audio/wav', byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			semantic: { kind: 'audio-wave', role: 'enhanced-audio', sampleRate: 48_000,
				channelCount: 1, frameCount: 4, sampleFormat: 'float32' } }],
		choices: [{ id: 'enhanced-audio', kind: 'audio', label: 'Enhanced Dialogue', selected: false, enabled: true }],
	};
	const choices: Array<readonly [string, boolean]> = [];
	const render = async (gain: number): Promise<void> => {
		await act(async () => root.render(<AudioEditorListeningGainContext.Provider value={gain}>
			<LocalAssistanceGuidedReview copy={{}} review={review} auditionAudio={original}
				selectedChoiceIds={[]} onChoiceChange={(id, selected) => { choices.push([id, selected]); }} />
		</AudioEditorListeningGainContext.Provider>));
	};
	try {
		await render(initialGain);
		const elements = dom.container.querySelectorAll('audio');
		assert.equal(elements.length, 2, 'ordinary enhancement reviews retain original and result players');
		const audio = elements.map(element => element as unknown as HTMLAudioElement);
		const sources = elements.map(element => element.getAttribute('src'));
		assert.ok(sources.every(source => source?.startsWith('blob:')));
		for (const player of audio) assert.equal(player.volume ?? 1, initialGain, 'new review players inherit current gain');
		Object.defineProperty(audio[0], 'paused', { configurable: true, writable: true, value: false });
		Object.defineProperty(audio[1], 'paused', { configurable: true, writable: true, value: true });
		for (const player of audio) player.currentTime = 0.25;
		await render(0);
		for (const player of audio) assert.equal(player.volume ?? 1, 0, 'each independently owned review player receives mute');
		await render(0.25);
		for (const [index, player] of audio.entries()) {
			assert.equal(player.volume, 0.25);
			assert.equal(player.currentTime, 0.25);
			assert.equal(dom.container.querySelectorAll('audio')[index], elements[index]);
			assert.equal(elements[index]?.getAttribute('src'), sources[index]);
		}
		assert.equal(audio[0]?.paused, false);
		assert.equal(audio[1]?.paused, true, 'gain changes do not resume a paused result');
		const choice = dom.one('[role="checkbox"]');
		await act(async () => reactProps(choice).onClick());
		assert.deepEqual(choices, [['enhanced-audio', true]], 'review authority and choice identity remain usable');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
