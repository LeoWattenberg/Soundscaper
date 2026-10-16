/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const warped of [false, true]) test(`media Reverse availability matches the canonical ${warped ? 'warped' : 'ordinary'} clip`, async () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
		...(warped ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 36_000, mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}) });
	const project = createSoundscaperProject({ id: 'project', title: 'Recording', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const command = { type: 'clip/update' as const, clipId: clip.id, changes: { reversed: true } };
	if (warped) assert.throws(() => applySoundscaperProjectCommand(project, command), (error: unknown) =>
		error instanceof RangeError && error.cause instanceof RangeError && /forward/iu.test(error.cause.message));
	else assert.equal(applySoundscaperProjectCommand(project, command).clips[0]?.reversed, true);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<ClipPropertiesBody controller={{ project, actions: { clip: {} } }}
			snapshot={{ project, selectedClipId: clip.id, capabilities: { audioEffects: true } }} copy={ENGLISH_COPY} />));
		const reverse = dom.one('[data-clip-field="reversed"]').querySelector('[role="checkbox"]');
		const invert = dom.one('[data-clip-field="inverted"]').querySelector('[role="checkbox"]');
		assert.ok(reverse && invert);
		assert.equal(reverse.getAttribute('aria-disabled') === 'true', warped);
		assert.notEqual(invert.getAttribute('aria-disabled'), 'true', 'polarity remains supported with a warp');
		assert.deepEqual(project.clips, [clip], 'availability does not mutate source or authored timing');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
