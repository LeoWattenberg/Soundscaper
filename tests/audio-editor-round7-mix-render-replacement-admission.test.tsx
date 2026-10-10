/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MixRenderDialog from '../src/common/editor/ui/dialogs/MixRenderDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeMixRenderOptions, type MixRenderOptions } from '../src/common/editor/controller/track-audio/mix-render-options.ts';
import { assertMixRenderPreflight } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-operation-model.ts';
import { nonemptyAudioTargets } from '../src/common/editor/controller/track-audio/mix-render-output-layout.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('actual native Mix and Render rejects a destructive locked request at its modal admission while retaining new-track prints', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const accepted: MixRenderOptions[] = [];
	let project = nativeProject(false);
	let current = project as unknown as ControllerProject;
	let closes = 0;
	const controller = { actions: { track: { mixAndRender: (options: MixRenderOptions) => {
		assertMixRenderPreflight(current, nonemptyAudioTargets(current, current.tracks), normalizeMixRenderOptions(options));
		accepted.push(options);
	} } } };
	const render = async () => {
		current = project as unknown as ControllerProject;
		await act(async () => { root.render(<MixRenderDialog controller={controller}
			snapshot={{ project: current, selectedTrackId: 'voice', selectedClipId: 'voice-clip' }}
			copy={ENGLISH_COPY} run={operation => operation()} onClose={() => { closes += 1; }} />); });
	};
	const submit = () => {
		const button = dom.container.querySelectorAll('button').find(item => item.textContent === ENGLISH_COPY.mixRenderTitle);
		assert.ok(button);
		return button;
	};
	const replace = () => {
		const control = dom.container.querySelectorAll('[role="checkbox"]')
			.find(item => item.getAttribute('aria-label') === ENGLISH_COPY.replaceOriginals);
		assert.ok(control);
		return control;
	};
	try {
		await render();
		assert.equal(reactProps(submit()).disabled, false);
		await act(async () => { reactProps(submit()).onClick(); });
		assert.equal(accepted.length, 1);
		assert.equal(accepted[0]?.replaceOriginals, true);
		assert.equal(closes, 1);
		project = nativeProject(true);
		await render();
		assert.throws(() => assertMixRenderPreflight(current, current.tracks,
			normalizeMixRenderOptions({ mixDown: true, renderEffects: true, replaceOriginals: true })), /locked track/u);
		assert.equal(reactProps(submit()).disabled, true,
			'the same actually protected request must not remain admitted by the modal');
		assert.equal(dom.one('[role="alert"]').textContent, ENGLISH_COPY.mixRenderLockedOriginals);
		await act(async () => { reactProps(replace()).onClick({}); });
		assert.equal(reactProps(submit()).disabled, false);
		await act(async () => { reactProps(submit()).onClick(); });
		assert.equal(accepted.length, 2);
		assert.equal(accepted[1]?.replaceOriginals, false);
		assert.equal(closes, 2);
		project = nativeProject(false);
		await render();
		await act(async () => { reactProps(replace()).onClick({}); });
		assert.equal(reactProps(submit()).disabled, false, 'unlock restores the existing destructive option');
		project = nativeProject(false, true);
		await render();
		assert.equal(reactProps(submit()).disabled, false, 'an empty selected locked track is not a rendered original');
		await act(async () => { reactProps(submit()).onClick(); });
		assert.equal(accepted.length, 3);
		assert.equal(accepted[2]?.replaceOriginals, true);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function nativeProject(locked: boolean, emptyLocked = false) {
	return createSoundscaperProject({ id: 'locked-render', title: 'Voice project',
		sources: [createAudioSource({ id: 'voice-source', storageKey: 'voice-source', name: 'Voice.wav',
			frameCount: 48_000, channelCount: 1, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'voice-clip', sourceId: 'voice-source', title: 'Voice',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], locked }),
			...(emptyLocked ? [createAudioTrack({ id: 'empty', name: 'Empty', clipIds: [], locked: true })] : [])],
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['voice', ...(emptyLocked ? ['empty'] : [])], clipIds: ['voice-clip'] },
	});
}
