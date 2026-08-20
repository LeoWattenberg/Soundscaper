/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInterchangeVisibility } from '../src/common/editor/interchange-track-visibility.ts';
import { createMixerGraphAudibilityV21 } from '../src/common/editor/mixer-graph-audibility-v21.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommandV21 } from '../src/soundscaper/editor-project-v21-commands.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

/**
 * What the routing graph silences, an exported edit list leaves out.
 *
 * A track's own mute and solo stopped being the whole answer when the V21 graph
 * arrived: solo is resolved over the routing, so a soloed group makes everything
 * feeding it audible and silences everything else; a group or send carries its
 * own mute, so a track that reaches the mix only through a muted bus is silent;
 * and a muted VCA zeroes every strip in it. The render honours all of that. The
 * interchange profiles read `track.mute` and `track.solo` alone, so their files
 * both kept tracks the render silences and dropped tracks it keeps.
 */

const NOW = '2026-08-19T12:00:00.000Z';

test('a track that reaches the mix only through a muted bus is not in the file', () => {
	const project = routedProject({ busMuted: true });
	const audibility = createMixerGraphAudibilityV21(project);
	assert.ok(audibility);
	assert.equal(audibility.audibleTrack('voice'), false);
	assert.equal(audibility.reason('voice'), 'routed-to-silence');
	// The track that feeds master directly is unaffected.
	assert.equal(audibility.audibleTrack('music'), true);

	const visibility = createInterchangeVisibility(project.tracks as never, project);
	assert.equal(visibility.contributes(track(project, 'voice') as never), false);
	assert.equal(visibility.contributes(track(project, 'music') as never), true);
});

test('an open bus leaves the track it carries in the file', () => {
	const project = routedProject({ busMuted: false });
	const audibility = createMixerGraphAudibilityV21(project);
	assert.equal(audibility?.audibleTrack('voice'), true);
});

test('a muted VCA silences the strips it holds', () => {
	const project = vcaProject();
	const audibility = createMixerGraphAudibilityV21(project);
	assert.equal(audibility?.audibleTrack('voice'), false);
	assert.equal(audibility?.reason('voice'), 'muted');
	assert.equal(audibility?.audibleTrack('music'), true);
});

test('a document with no routing graph keeps the track-flag rule', () => {
	const legacy = {
		schemaVersion: 17,
		tracks: [
			{ id: 'voice', type: 'audio', mute: false, solo: false },
			{ id: 'music', type: 'audio', mute: true, solo: false },
		],
		mixer: { groups: [], sends: [], routes: {} },
	};
	assert.equal(createMixerGraphAudibilityV21(legacy), null);
	const visibility = createInterchangeVisibility(legacy.tracks as never, legacy);
	assert.equal(visibility.contributes(legacy.tracks[0] as never), true);
	assert.equal(visibility.contributes(legacy.tracks[1] as never), false);
});

function routedProject({ busMuted }: { busMuted: boolean }) {
	const base = createSoundscaperProjectV21({
		id: 'graph-audibility', title: 'Graph audibility', now: NOW,
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
	});
	const withBus = applySoundscaperProjectCommandV21(base, {
		type: 'mixer/bus-add', busType: 'group', bus: { id: 'stems', name: 'Stems' },
	} as never, { now: NOW });
	const routed = applySoundscaperProjectCommandV21(withBus, {
		type: 'mixer-graph/set',
		expected: withBus.mixer,
		mixer: {
			...withBus.mixer,
			groups: withBus.mixer.groups.map((bus) => (
				bus.id === 'stems' ? { ...bus, mute: busMuted } : bus
			)),
			edges: [
				...withBus.mixer.edges.filter(({ id }) => id !== 'assignment:track:voice:master'),
				{
					id: 'assignment:track:voice:mixer-node:stems', kind: 'assignment',
					source: { kind: 'track', id: 'voice' },
					destination: { kind: 'mixer-node', id: 'stems' },
					position: 'post-fader', level: 1, enabled: true, channelMap: [],
				},
			],
		},
	} as never, { now: NOW });
	return routed;
}

function vcaProject() {
	const base = createSoundscaperProjectV21({
		id: 'graph-audibility-vca', title: 'Graph audibility VCA', now: NOW,
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'music'] }],
		primarySequenceId: 'main-sequence',
	});
	return applySoundscaperProjectCommandV21(base, {
		type: 'mixer-graph/set',
		expected: base.mixer,
		mixer: {
			...base.mixer,
			vcas: [{
				id: 'vca-a', name: 'VCA', gain: 1, mute: true,
				members: [{ kind: 'track', id: 'voice' }],
			}],
		},
	} as never, { now: NOW });
}

function track(project: { readonly tracks: readonly Record<string, unknown>[] }, id: string) {
	return project.tracks.find((candidate) => candidate.id === id);
}
