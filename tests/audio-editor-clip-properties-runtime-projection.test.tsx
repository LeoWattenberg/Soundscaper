/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('clip properties projects persisted beat extents for the source overlay and numeric fields', () => {
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		for (const [bpm, start, duration, left, width] of [
			[120, 72_000, 48_000, 50.4, 100.8],
			[60, 144_000, 96_000, 42, 168],
		] as const) {
			const project = musicalProject(bpm);
			assert.equal(Object.hasOwn(project.clips[0]!, 'durationFrames'), false);
			const controller = { getClipVisualData: () => null, actions: {
				clip: {}, clipSourcePreview: { snapshot: () => ({ state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
			} };
			const markup = renderToStaticMarkup(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY}
				snapshot={{ project, selectedClipId: 'clip', capabilities: { audioEffects: false } }} />);
			const overlay = markup.match(/class="audio-editor-source-clip"[^>]+/u)?.[0] ?? '';
			assert.ok(Math.abs(Number(overlay.match(/left:([^p]+)px/u)?.[1]) - left) < 0.001, overlay);
			assert.ok(Math.abs(Number(overlay.match(/width:([^p]+)px/u)?.[1]) - width) < 0.001, overlay);
			for (const [field, value] of [['startFrame', start], ['durationFrame', duration]] as const) {
				const content = markup.split(`data-clip-field="${field}"`)[1]?.split('</label>')[0] ?? '';
				assert.ok(content.includes(`value="${value}"`), `${field} should display its resolved samples`);
			}
			assert.equal(Object.hasOwn(project.clips[0]!, 'timelineStartFrame'), false, 'projection never mutates persisted beats');
			assert.equal(Object.hasOwn(project.clips[0]!, 'durationFrames'), false);
		}
	} finally {
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});

function musicalProject(bpm: number) {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 240_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Clip',
		timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 24_000, sourceDurationFrames: 48_000 });
	const initial = createSoundscaperProject({ id: 'project', title: 'Project', sampleRate: 48_000,
		now: '2026-10-02T00:00:00.000Z', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: [clip.id] })] });
	const { timelineStartFrame: _start, durationFrames: _duration, ...persisted } = initial.clips[0]!;
	return { ...initial,
		tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: bpm, den: 1 } }] },
		clips: [{ ...persisted, anchor: 'musical' as const, musicalExtent: 'beat' as const,
			musicalStartBeat: { num: 3, den: 1 }, musicalDurationBeats: { num: 2, den: 1 } }],
	};
}
