/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('pitch unit changes retain chooser and input identity while refreshing the converted draft', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000,
		pitchCents: 200 });
	const project = createSoundscaperProject({ id: 'project', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: [clip.id] })] });
	const edits: unknown[] = [];
	const controller = { project, actions: { clip: { setTimePitch: (...args: unknown[]) => { edits.push(args); } } } };
	try {
		await act(async () => { root.render(<ClipPropertiesBody controller={controller}
			snapshot={{ project, selectedClipId: clip.id, capabilities: { audioEffects: true } }} copy={ENGLISH_COPY} />); });
		const chooser = dom.one('[data-clip-pitch-unit]');
		const buttons = chooser.querySelectorAll('button');
		assert.equal(buttons.length, 2);
		const semitones = buttons[0]!;
		const percent = buttons[1]!;
		const input = dom.one('[data-clip-field="pitchCents"]').querySelector('input');
		assert.ok(input);
		assert.equal(input.value, '2.00');
		for (const [button, expected] of [[percent, '12.246'], [semitones, '2.00']] as const) {
			button.focus();
			await act(async () => { reactProps(button).onClick?.({}); });
			assert.equal(dom.one('[data-clip-pitch-unit]'), chooser, 'the unit controls remain mounted');
			assert.equal(button.isConnected, true);
			assert.equal(button.getAttribute('aria-pressed'), 'true');
			assert.equal(document.activeElement, button);
			assert.equal(dom.one('[data-clip-field="pitchCents"]').querySelector('input'), input);
			assert.equal(input.value, expected);
		}
		assert.deepEqual(edits, [], 'changing a reading does not change the stored pitch');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});
