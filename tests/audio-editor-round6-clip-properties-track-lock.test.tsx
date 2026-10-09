/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const panel of [false, true]) test(`the ${panel ? 'live panel' : 'properties body'} follows canonical lock and unlock`, async () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording',
		sourceDurationFrames: 48_000, durationFrames: 48_000 });
	const other = createAudioClip({ ...clip, id: 'other', title: 'Other recording' });
	let project = createSoundscaperProject({ sources: [source], clips: [clip, other],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] }),
			createAudioTrack({ id: 'other-track', clipIds: [other.id] })] });
	project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'other-track', changes: { locked: true } });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const render = async () => {
		const props = { controller: { project, actions: { clip: {} } },
			snapshot: { project, selectedClipId: clip.id, capabilities: { audioEffects: true } }, copy: ENGLISH_COPY };
		await act(async () => root.render(panel ? <ClipPropertiesPanel {...props} /> : <ClipPropertiesBody {...props} />));
	};
	try {
		await render();
		const name = () => dom.one('[data-clip-field="name"]').querySelector('input');
		assert.equal(name()?.getAttribute('disabled'), null);
		project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'track', changes: { locked: true } });
		assert.throws(() => applySoundscaperProjectCommand(project, {
			type: 'clip/update', clipId: clip.id, changes: { title: 'Refused rename' },
		}), (error: unknown) => error instanceof RangeError && /locked/u.test(error.message));
		await render();
		assert.equal(project.tracks[0]?.locked, true);
		assert.equal(dom.one('[data-clip-fields]').getAttribute('aria-disabled'), 'true');
		assert.notEqual(name()?.getAttribute('disabled'), null);
		assert.equal(dom.one('[data-clip-field="inverted"]').querySelector('[role="checkbox"]')?.getAttribute('aria-disabled'), 'true');
		assert.notEqual(dom.one('[data-clip-action="normalize-peak"]').querySelector('button')?.getAttribute('disabled'), null);
		project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'track', changes: { locked: false } });
		await render();
		assert.equal(name()?.getAttribute('disabled'), null);
		assert.notEqual(dom.one('[data-clip-field="inverted"]').querySelector('[role="checkbox"]')?.getAttribute('aria-disabled'), 'true');
		assert.equal(project.clips[0]?.title, 'Recording');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
