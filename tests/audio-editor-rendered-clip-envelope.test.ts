/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A destructive effect that changes duration rewrites the clips grouped with the
 * one it rendered, scaling their envelope frames by the same ratio. Scaling can
 * land two points on one frame, and a project envelope must use strictly
 * increasing frames, so an unmerged collision fails validation and takes the
 * whole command down with it - the effect simply refuses to apply.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip, createAudioSource, createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-29T12:00:00.000Z';

interface EnvelopePoint { readonly frame: number; readonly value: number }

function groupedProject(envelope: readonly EnvelopePoint[]) {
	return createAudioEditorProjectV17({
		id: 'rendered-envelope',
		title: 'Rendered envelope',
		now: NOW,
		sources: [
			createAudioSource({
				id: 'source-a', storageKey: 'a', name: 'A',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'source-b', storageKey: 'b', name: 'B',
				frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [
			createAudioTrack({ id: 'track-a', name: 'A', clipIds: ['clip-a'] }),
			createAudioTrack({ id: 'track-b', name: 'B', clipIds: ['clip-b'] }),
		],
		clips: [
			createAudioClip({
				id: 'clip-a', trackId: 'track-a', sourceId: 'source-a',
				timelineStartFrame: 0, durationFrames: 1_000, sourceStartFrame: 0, groupId: 'group',
			}),
			createAudioClip({
				id: 'clip-b', trackId: 'track-b', sourceId: 'source-b',
				timelineStartFrame: 0, durationFrames: 1_000, sourceStartFrame: 0, groupId: 'group',
				envelope: envelope.map((point) => ({ ...point })),
			}),
		],
		sequences: [{ id: 'main', trackIds: ['track-a', 'track-b'] }],
		primarySequenceId: 'main',
	});
}

/** Render `clip-a` down to a tenth of its length, as Change Tempo would. */
function renderTenfoldFaster(project: ReturnType<typeof groupedProject>) {
	return applyEditorCommand(project, {
		type: 'clip/render-replace-many',
		entries: [{
			clipId: 'clip-a',
			source: {
				id: 'rendered-a', storageKey: 'rendered-a', name: 'Rendered A',
				frameCount: 100, channelCount: 1, sampleRate: 48_000,
			},
		}],
	}, { now: NOW });
}

test('a grouped neighbour whose envelope points collide still renders', () => {
	const rendered = renderTenfoldFaster(groupedProject([
		{ frame: 10, value: 0.3 },
		{ frame: 11, value: 0.9 },
		{ frame: 900, value: 0.5 },
	]));
	const neighbour = rendered.clips.find((clip) => clip.id === 'clip-b');

	assert.equal(neighbour?.durationFrames, 100);
	// Frames 10 and 11 both scale onto frame 1; the later point is the value the
	// material carries out of the region that collapsed.
	assert.deepEqual(neighbour?.envelope, [{ frame: 1, value: 0.9 }, { frame: 90, value: 0.5 }]);
});

test('points that stay distinct keep every value, scaled', () => {
	const rendered = renderTenfoldFaster(groupedProject([
		{ frame: 0, value: 0.2 },
		{ frame: 500, value: 0.7 },
		{ frame: 1_000, value: 0.4 },
	]));

	assert.deepEqual(rendered.clips.find((clip) => clip.id === 'clip-b')?.envelope, [
		{ frame: 0, value: 0.2 }, { frame: 50, value: 0.7 }, { frame: 100, value: 0.4 },
	]);
});

test('a tail beyond the shortened clip collapses onto its last frame', () => {
	const rendered = renderTenfoldFaster(groupedProject([
		{ frame: 0, value: 0.2 },
		{ frame: 995, value: 0.6 },
		{ frame: 1_000, value: 0.3 },
	]));

	assert.deepEqual(rendered.clips.find((clip) => clip.id === 'clip-b')?.envelope, [
		{ frame: 0, value: 0.2 }, { frame: 100, value: 0.3 },
	]);
});

test('separate rendered components retain earlier ripple shifts', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const project = createAudioEditorProjectV17({
		id: 'separate-rendered-components', title: 'Separate rendered components', now: NOW,
		sources: [source],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['a', 'b', 'tail'] })],
		clips: [
			createAudioClip({ id: 'a', trackId: 'track', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0 }),
			createAudioClip({ id: 'b', trackId: 'track', sourceId: source.id,
				timelineStartFrame: 200, durationFrames: 100, sourceStartFrame: 100 }),
			createAudioClip({ id: 'tail', trackId: 'track', sourceId: source.id,
				timelineStartFrame: 400, durationFrames: 100, sourceStartFrame: 200 }),
		],
		sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main',
	});
	const rendered = applyEditorCommand(project, {
		type: 'clip/render-replace-many',
		entries: [
			{ clipId: 'a', source: { id: 'rendered-a', storageKey: 'rendered-a', name: 'A',
				frameCount: 200, channelCount: 1, sampleRate: 48_000 } },
			{ clipId: 'b', source: { id: 'rendered-b', storageKey: 'rendered-b', name: 'B',
				frameCount: 200, channelCount: 1, sampleRate: 48_000 } },
		],
	}, { now: NOW });
	assert.deepEqual(rendered.clips.map(({ id, timelineStartFrame, durationFrames }) => ({
		id, timelineStartFrame, durationFrames,
	})), [
		{ id: 'a', timelineStartFrame: 0, durationFrames: 200 },
		{ id: 'b', timelineStartFrame: 300, durationFrames: 200 },
		{ id: 'tail', timelineStartFrame: 600, durationFrames: 100 },
	]);
});
