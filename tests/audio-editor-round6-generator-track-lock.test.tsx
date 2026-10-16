/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [locked, selected, focused, expectedBlocked] of [
	['one', ['one'], 'one', true], ['two', ['one', 'two'], 'one', true],
	['two', ['one'], 'one', false], [null, ['one', 'two'], 'one', false],
	['one', [], 'one', false],
] as const) {
	test(`the generator resolves the selected lock target ${JSON.stringify({ locked, selected, focused })}`, async () => {
		const dom = installReactTestDom();
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let calls = 0;
		let closes = 0;
		const project = createSoundscaperProject({ id: 'generator-target', sampleRate: 48_000,
			now: '2026-10-09T12:00:00.000Z', tracks: ['one', 'two'].map(id =>
				createAudioTrack({ id, locked: id === locked, clipIds: id === 'one' ? ['one-clip'] : [] })),
			sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })],
			clips: [createAudioClip({ id: 'one-clip', sourceId: 'source', timelineStartFrame: 0,
				durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 })],
			selection: { startFrame: 0, endFrame: selected.length ? 48_000 : 0, trackIds: [...selected], clipIds: [] },
		});
		const controller = { project, actions: { generators: { generate: () => { calls++; } } } };
		const button = (name: string) => {
			const found = dom.container.querySelectorAll('button').find(item => item.textContent === name);
			assert.ok(found);
			return found;
		};
		try {
			await act(async () => { root.render(<GeneratorDialog type="silence" controller={controller}
				snapshot={{ selectedTrackId: focused }} copy={ENGLISH_COPY} locale="en"
				run={(operation: () => unknown) => operation()} onClose={() => { closes++; }} />); });
			assert.equal(button('Generate').hasAttribute('disabled'), expectedBlocked);
			assert.equal(button('Cancel').hasAttribute('disabled'), false);
			await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined }); });
			assert.equal(calls, expectedBlocked ? 0 : 1);
			assert.equal(closes, expectedBlocked ? 0 : 1);
			if (expectedBlocked) {
				await act(async () => { reactProps(button('Generate')).onClick(); });
				assert.equal(calls, 0, 'the shared footer releases the same locked target as form submission');
				await act(async () => { reactProps(button('Cancel')).onClick(); });
				assert.equal(closes, 1);
			}
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
