/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SourcePropertiesPanel } from '../src/common/editor/ui/toolbar/SourcePropertiesPanel.jsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const PAL = { num: 25, den: 1 };

function source(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'video',
		id: 'video-source',
		name: 'Take 1.mov',
		width: 1_024,
		height: 576,
		frameRate: PAL,
		sourceFrameCount: 250,
		videoCodec: 'unknown',
		audioCodec: null,
		timingDecision: { mode: 'exact', rate: PAL, backend: 'ffmpeg' },
		...overrides,
	};
}

// The tsx test loader compiles JSX classically, so the React import must stay
// referenced for the compiled createElement calls to resolve.
const render = (element: ReturnType<typeof React.createElement>): string => renderToStaticMarkup(element);

test('an unprobed source renders every characteristic as an explicit unknown', () => {
	const markup = render(<SourcePropertiesPanel source={source()} copy={ENGLISH_COPY} />);
	assert.match(markup, /data-source-properties="video-source"/u);
	assert.equal(markup.match(/data-reported="false"/gu)?.length, 9, 'unreported values are marked, not filled in');
	assert.match(markup, /Unknown/u);
	assert.match(markup, /data-source-audio-streams="0"/u);
});

test('a probed source renders its picture description and its disclosures', () => {
	const markup = render(<SourcePropertiesPanel source={source({
		characteristics: {
			backend: 'ffmpeg',
			codedWidth: 720,
			codedHeight: 576,
			pixelAspectRatio: { num: 64, den: 45 },
			fieldOrder: 'top-field-first',
			hasAlpha: false,
			videoCodec: 'mpeg2video',
			colour: { primaries: 'bt470bg', transfer: 'smpte170m', matrix: 'bt470bg', range: 'limited' },
			audioStreams: [
				{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' },
				{ index: 2, codec: 'ac3', channelCount: 6, sampleRate: 48_000, language: 'deu' },
			],
			extractedAudioStreamIndex: 1,
			startTimecode: { negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		},
	})} copy={ENGLISH_COPY} />);
	assert.match(markup, /mpeg2video/u);
	assert.match(markup, /720 × 576/u);
	assert.match(markup, /64:45/u);
	assert.match(markup, /10:00:00:00/u);
	assert.match(markup, /data-source-audio-streams="2"/u);
	assert.match(markup, /#1 · aac · 2ch · 48000 Hz · eng/u);
	assert.match(markup, /data-source-note="interlaced-presented-as-coded"/u);
	assert.match(markup, /data-source-note="additional-audio-programs"/u);
	assert.match(markup, /nothing deinterlaces it/u);
	assert.match(markup, /data-source-reconciliation="applied"/u);
});

test('a rotation the player did not apply is disclosed on the surface', () => {
	const markup = render(<SourcePropertiesPanel source={source({
		width: 1_920,
		height: 1_080,
		characteristics: { backend: 'ffmpeg', codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 90 },
	})} copy={ENGLISH_COPY} />);
	assert.match(markup, /data-source-note="rotation-not-applied"/u);
	assert.match(markup, /data-source-reconciliation="residual"/u);
	assert.match(markup, /90°/u);
});

test('the re-read action is offered only where a controller can perform it', () => {
	const withoutAction = render(<SourcePropertiesPanel source={source()} copy={ENGLISH_COPY} />);
	assert.doesNotMatch(withoutAction, /data-source-reprobe/u);

	const offered = render(
		<SourcePropertiesPanel source={source()} copy={ENGLISH_COPY} onReprobe={() => Promise.resolve()} />,
	);
	assert.match(offered, /data-source-reprobe="video-source"/u);
	assert.match(offered, /Re-read source/u);
	assert.doesNotMatch(offered, /disabled/u);

	const blocked = render(
		<SourcePropertiesPanel
			source={source()}
			copy={GERMAN_COPY}
			disabled
			onReprobe={() => Promise.resolve()}
		/>,
	);
	assert.match(blocked, /Quelle neu einlesen/u);
	assert.match(blocked, /disabled/u);
});

test('no clip under the playhead renders an empty panel rather than a guess', () => {
	const markup = render(<SourcePropertiesPanel source={null} copy={ENGLISH_COPY} />);
	assert.match(markup, /data-source-properties="empty"/u);
	assert.match(markup, /No clip under the playhead/u);
});

test('the German catalog carries the source properties copy', () => {
	const markup = render(<SourcePropertiesPanel source={source({
		characteristics: { backend: 'ffmpeg', fieldOrder: 'bottom-field-first' },
	})} copy={GERMAN_COPY} />);
	assert.match(markup, /Quelleneigenschaften/u);
	assert.match(markup, /Unbekannt/u);
	assert.match(markup, /deinterlaced/u);
});
