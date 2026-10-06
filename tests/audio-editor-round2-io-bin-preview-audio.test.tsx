/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ProjectBinCard from '../src/common/editor/ui/workspace/ProjectBinCard.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('a video-only Project Bin item cannot play deleted original audio, while a paired item retains it', () => {
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		const video = { id: 'video', kind: 'video', sourceId: 'video-source', title: 'Take', binItemId: 'item', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 0, sourceFrameCount: 60 };
		const source = { id: 'video-source', kind: 'video', frameRate: { num: 30, den: 1 }, sourceFrameCount: 60, sampleFrameCount: 96_000, sampleRate: 48_000 };
		const audio = { id: 'audio', kind: 'audio', sourceId: 'audio-source', title: 'Take Audio', binItemId: 'item', durationFrames: 96_000, sourceDurationFrames: 96_000, sourceStartFrame: 0, timelineStartFrame: 0 };
		const render = (withAudio: boolean) => renderToStaticMarkup(<ProjectBinCard
			clip={video} itemClips={withAudio ? [video, audio] : [video]} source={source} sources={[source]}
			project={{ id: 'project', schemaVersion: 17, sampleRate: 48_000, primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], sources: [source] }}
			controller={{ actions: { projectBin: { getVisualData: () => ({ mediaUrl: 'blob:original-with-audio' }), instanceCount: () => 0 } } }}
			copy={ENGLISH_COPY} locale="en" mutationBlocked={false} missing={false} selectedMediaTrack={null}
			preview={{ clipId: 'video', binItemId: 'item', kind: 'video', state: 'playing' }}
			run={() => undefined} onOpenMenu={() => undefined} onDragEnd={() => undefined}
		/>);
		const silent = render(false);
		assert.match(silent, /No audio/u);
		assert.match(silent, /<video\b[^>]*\bmuted=""/u, 'removing the companion must silence the embedded original');
		const paired = render(true);
		assert.match(paired, /With audio/u);
		assert.doesNotMatch(paired, /<video\b[^>]*\bmuted=""/u);
	} finally {
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});
