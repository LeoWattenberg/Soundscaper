/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesBody from '../src/common/editor/ui/inspector/ClipPropertiesBody.jsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('media controls read source time at its own rate and slip only the selected clip', async () => {
	const f = await fixture();
	try {
		assert.equal(f.digits('sourceInFrame'), '000001000');
		assert.equal(f.digits('durationFrame'), '000001000');
		await f.commit('sourceInFrame', 48_000);
		assert.deepEqual(f.trims, [{ clipId: 'clip', changes: {
			sourceStartFrame: 48_000, sourceDurationFrames: 48_000, durationFrames: 48_000,
		} }]);
		assert.deepEqual(f.timelineTrims, []);
		assert.equal(f.project.clips[0]!.timelineStartFrame, 192_000);
	} finally { await f.cleanup(); }
});

test('source in clamps the retained span at the end of the media', async () => {
	const f = await fixture();
	try {
		await f.commit('sourceInFrame', 228_000);
		assert.deepEqual(f.trims[0]?.changes, {
			sourceStartFrame: 228_000, sourceDurationFrames: 12_000, durationFrames: 12_000,
		});
	} finally { await f.cleanup(); }
});

test('duration uses the clip source-to-project ratio including speed and keeps reversed media anchored', async () => {
	for (const reversed of [false, true]) {
		const f = await fixture(reversed, 1.5);
		try {
			await f.commit('durationFrame', 32_000);
			assert.deepEqual(f.trims[0]?.changes, {
				sourceStartFrame: reversed ? 48_000 : 24_000, sourceDurationFrames: 24_000, durationFrames: 32_000,
			});
			assert.deepEqual(f.timelineTrims, []);
		} finally { await f.cleanup(); }
	}
});

async function fixture(reversed = false, speedRatio = 2) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 240_000, channelCount: 1, sampleRate: 24_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Clip',
		timelineStartFrame: 192_000, sourceStartFrame: 24_000, sourceDurationFrames: 48_000,
		durationFrames: Math.round(96_000 / speedRatio), speedRatio, reversed });
	const project = createSoundscaperProject({ id: 'project', title: 'Project', sampleRate: 48_000,
		now: '2026-10-02T00:00:00.000Z', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: [clip.id] })] });
	const trims: Array<{ clipId: string; changes: Readonly<Record<string, number>> }> = [];
	const timelineTrims: unknown[] = [];
	const controller = { project, actions: {
		clipSourcePreview: { trim: (clipId: string, changes: Readonly<Record<string, number>>) => { trims.push({ clipId, changes }); } },
		clip: { trim: (...args: unknown[]) => { timelineTrims.push(args); } },
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipPropertiesBody controller={controller}
		snapshot={{ project, selectedClipId: 'clip', capabilities: { audioEffects: false } }} copy={ENGLISH_COPY} />));
	const field = (name: string) => dom.one(`[data-clip-field="${name}"]`);
	return {
		project, trims, timelineTrims,
		digits: (name: string) => field(name).querySelectorAll('.timecode-digit').map(node => node.textContent).join(''),
		commit: async (name: string, value: number) => {
			const input = field(name).querySelector('input');
			assert.ok(input);
			await act(async () => reactProps(input).onChange({ currentTarget: { valueAsNumber: value } }));
			const wrapper = field(name).querySelector('[data-timecode-input]');
			assert.ok(wrapper);
			await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
