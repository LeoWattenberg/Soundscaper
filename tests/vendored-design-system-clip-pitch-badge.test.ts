/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { Clip, clipPitchShiftLabel } from '../vendor/audacity-design-system/components/src/Clip/Clip.tsx';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';
import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

function render(element: React.ReactElement): string {
	return renderToStaticMarkup(React.createElement(ThemeProvider, null, element));
}

function badgeValues(markup: string): string[] {
	return [...markup.matchAll(/class="clip-header__badge-value">([^<]*)</gu)].map((match) => match[1]);
}

test('the pitch badge writes semitones the way Audacity does', () => {
	// GetPitchShiftText formats two decimals and then removes the trailing
	// zeros, so a whole semitone reads as a bare figure.
	assert.equal(clipPitchShiftLabel(100), '+1');
	assert.equal(clipPitchShiftLabel(-100), '-1');
	assert.equal(clipPitchShiftLabel(250), '+2.5');
	assert.equal(clipPitchShiftLabel(-250), '-2.5');
	assert.equal(clipPitchShiftLabel(404), '+4.04');
	assert.equal(clipPitchShiftLabel(1_200), '+12');
	assert.equal(clipPitchShiftLabel(-1_200), '-12');
	// A shift finer than a cent is not one a clip can store, and rounding it
	// away must never leave a badge reading a bare sign.
	assert.equal(clipPitchShiftLabel(0), '');
	assert.equal(clipPitchShiftLabel(0.4), '+0');
});

test('a clip carrying a pitch shift draws the badge, and an unshifted one draws none', () => {
	const shifted = render(React.createElement(Clip, {
		name: 'One',
		width: 320,
		height: 120,
		clipDuration: 2,
		clipPitchCents: -100,
	} as never));
	assert.deepEqual(badgeValues(shifted), ['-1']);

	const unshifted = render(React.createElement(Clip, {
		name: 'One',
		width: 320,
		height: 120,
		clipDuration: 2,
	} as never));
	assert.deepEqual(badgeValues(unshifted), []);
});

const pitchSource = {
	id: 'source', storageKey: 'source', revision: 1, name: 'Source',
	sampleRate: 48_000, frameCount: 100, channelCount: 1,
};
const pitchClip = {
	id: 'clip', sourceId: pitchSource.id, title: 'Clip', timelineStartFrame: 0,
	sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
	waveformStartFrame: 0, waveformEndFrame: 100, gain: 1,
	fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	envelope: [{ frame: 0, value: 1 }],
};
const pitchProjection = {
	controller: {
		getClipVisualData: () => null,
		getProjectBinClipVisualData: () => null,
	},
	sourceLookup: new Map([[pitchSource.id, pitchSource]]),
	clip: pitchClip,
	geometry: { overscanStartFrame: 0, pixelsPerSecond: 120, sampleRate: 48_000 },
	selection: { selectedClipIds: null },
	copy: { clip: 'Clip' },
	rendering: { color: 'blue' },
} as const;

function projectedPitchCents(pitchCents: number): number {
	return createTimelineClipViewModel({
		...pitchProjection,
		clip: { ...pitchClip, pitchCents },
	}).pitchCents;
}

function badgeFor(clipPitchCents: number): string[] {
	return badgeValues(render(React.createElement(Clip, {
		name: 'One',
		width: 320,
		height: 120,
		clipDuration: 2,
		clipPitchCents,
	} as never)));
}

test('a shift too fine to write as a semitone figure earns no badge', () => {
	// The badge is drawn whenever the shift is not exactly zero, so the label
	// and the badge only agree if the projection rounds the shift the way the
	// label does: below half a cent there is no figure to show, and a badge
	// reading '+0' would announce a shift of nothing.
	assert.equal(projectedPitchCents(0.4), 0);
	assert.deepEqual(badgeFor(projectedPitchCents(0.4)), []);
	assert.deepEqual(badgeFor(projectedPitchCents(-0.4)), []);
	// Half a cent is the smallest shift that still writes a figure, and it and
	// everything above it keep their badge.
	assert.equal(projectedPitchCents(0.5), 0.5);
	assert.deepEqual(badgeFor(projectedPitchCents(0.5)), ['+0.01']);
	assert.deepEqual(badgeFor(projectedPitchCents(120)), ['+1.2']);
});

test('the pitch badge sits beside the time-stretch badge it was modelled on', () => {
	const both = render(React.createElement(Clip, {
		name: 'One',
		width: 320,
		height: 120,
		clipDuration: 2,
		clipPitchCents: 700,
		clipStretchFactor: 2,
	} as never));
	assert.deepEqual(badgeValues(both), ['+7', '50%']);
});

test('a track passes each clip its own pitch shift', () => {
	const markup = renderToStaticMarkup(React.createElement(
		ThemeProvider,
		null,
		React.createElement(TrackNew, {
			clips: [
				{ id: 1, name: 'One', start: 0, duration: 2, pitchCents: 200 },
				{ id: 2, name: 'Two', start: 3, duration: 2 },
			],
			trackIndex: 0,
			width: 800,
		} as never),
	));
	assert.deepEqual(badgeValues(markup), ['+2']);
});

test('the deviation from upstream is recorded for the next sync', async () => {
	const readme = await readFile(
		new URL('../vendor/audacity-design-system/README.md', import.meta.url),
		'utf8',
	);
	assert.match(readme, /`Clip\.tsx` takes a `clipPitchCents` prop/u, 'the deviation is recorded');
});
