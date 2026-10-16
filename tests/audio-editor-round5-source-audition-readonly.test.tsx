/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

for (const [readOnly, recording, previewDisabled] of [[true, false, false], [true, true, true], [false, false, false]] as const) {
	test(`source audition admission separates readOnly=${String(readOnly)} from recording=${String(recording)}`, () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		try {
			const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
			const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
			const project = createSoundscaperProject({ id: 'project', now: '2026-10-08T10:00:00.000Z', sampleRate: 48_000,
				sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
			const controller = { getClipVisualData: () => ({ available: true, buffer: {
				length: 48_000, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => new Float32Array(48_000),
			} }), actions: { clip: {}, effects: {}, clipSourcePreview: { snapshot: () => ({ state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) } } };
			const markup = renderToStaticMarkup(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY}
				snapshot={{ project, selectedClipId: clip.id, readOnly, recording, capabilities: { audioEffects: false } }} />);
			const play = markup.match(/<button[^>]*aria-label="Play"[^>]*>/u)?.[0];
			assert.ok(play);
			assert.equal(play.includes('disabled'), previewDisabled, 'listening uses busy admission rather than edit authority');
			for (const label of ['Trim source start', 'Trim source end']) {
				const trim = markup.split(`aria-label="${label}"`)[1]?.split('>')[0];
				assert.ok(trim !== undefined);
				assert.equal(trim.includes('disabled'), readOnly || recording, 'persistent source editing keeps its original admission');
			}
		} finally {
			if (previous) Object.defineProperty(globalThis, 'React', previous);
			else Reflect.deleteProperty(globalThis, 'React');
		}
	});
}
