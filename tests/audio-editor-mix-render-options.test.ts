/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeMixRenderOptions,
} from '../src/common/editor/controller/mix-render-options.ts';
import {
	assertMixRenderPreflight,
} from '../src/common/editor/controller/mix-render-operation-model.ts';
import {
	createMixRenderSnapshot,
} from '../src/common/editor/controller/mix-render-model.ts';
import {
	predictMixRenderOutputChannelCount,
} from '../src/common/editor/controller/mix-render-output-layout.ts';
import type {
	ControllerProject,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';

test('Mix and Render defaults only the omitted object and rejects incomplete, invalid, or no-op requests', () => {
	assert.deepEqual(normalizeMixRenderOptions(), {
		mixDown: true, renderEffects: true, replaceOriginals: true,
	});
	assert.deepEqual(normalizeMixRenderOptions({
		mixDown: true, renderEffects: true, replaceOriginals: false,
	}), {
		mixDown: true, renderEffects: true, replaceOriginals: false,
	});
	assert.throws(
		() => normalizeMixRenderOptions({ replaceOriginals: false } as never),
		/Mix and Render option mixDown must be a boolean/,
	);
	assert.throws(
		() => normalizeMixRenderOptions({
			mixDown: true, renderEffects: 1, replaceOriginals: true,
		} as never),
		/Mix and Render option renderEffects must be a boolean/,
	);
	assert.throws(
		() => normalizeMixRenderOptions({
			mixDown: false, renderEffects: false, replaceOriginals: true,
		}),
		/Mix and Render must mix down, render effects, or both/,
	);
});

test('the Mix and Render layout predictor matches effect inclusion and skips empty targets', () => {
	const mono = track({ id: 'mono', clipIds: ['mono-clip'], effects: [{
		id: 'reverb', type: 'reverb', enabled: true,
	}] });
	const empty = track({ id: 'empty', clipIds: [] });
	const project = fixture({ tracks: [empty, mono] });

	assert.equal(predictMixRenderOutputChannelCount(project, [empty], true), null);
	assert.equal(predictMixRenderOutputChannelCount(project, [empty, mono], true), 2);
	assert.equal(predictMixRenderOutputChannelCount(project, [empty, mono], false), 1);
	assert.equal(predictMixRenderOutputChannelCount(project, [mono]), 2);
});

test('the Mix and Render layout predictor preserves exact production master width', () => {
	const target = track({ id: 'surround', clipIds: ['mono-clip'] });
	const project = fixture({ schemaVersion: 1, tracks: [target] }) as ControllerProject & {
		schemaFamily: 'soundscaper'; masterChannels: number;
	};
	project.schemaFamily = 'soundscaper';
	project.masterChannels = 6;
	assert.equal(predictMixRenderOutputChannelCount(project, [target], false), 6);
});

test('combined and individual snapshots differ at downstream routing and can omit effects', () => {
	const target = track({
		id: 'mono', clipIds: ['mono-clip'],
		effects: [{ id: 'track-reverb', type: 'reverb' }],
	});
	const project = fixture({
		tracks: [target],
		mixer: {
			groups: [{ id: 'group', pan: 0, effects: [{ id: 'bus-reverb', type: 'reverb' }] }],
			sends: [],
			routes: { mono: { groupId: 'group', sends: {} } },
		},
	});
	const combined = createMixRenderSnapshot(project, [target], {
		mixDown: true, renderEffects: true,
	});
	const individual = createMixRenderSnapshot(project, [target], {
		mixDown: false, renderEffects: true,
	});
	const dry = createMixRenderSnapshot(project, [target], {
		mixDown: true, renderEffects: false,
	});

	assert.deepEqual(combined.mixer.groups.map(({ id }) => id), ['group']);
	assert.deepEqual(individual.mixer.groups, []);
	assert.deepEqual(combined.tracks[0]?.effects?.map(({ id }) => id), ['track-reverb']);
	assert.deepEqual(dry.tracks[0]?.effects, []);
	assert.deepEqual(dry.mixer.groups[0]?.effects, []);
});

test('destructive Mix and Render preflight rejects locked and linked A/V targets', () => {
	const locked = track({ id: 'locked', locked: true, clipIds: ['mono-clip'] });
	const linked = track({ id: 'linked', laneGroupId: 'av-lanes', clipIds: ['linked-clip'] });
	const project = fixture({
		tracks: [locked, linked, track({ id: 'video', type: 'video', laneGroupId: 'av-lanes' })],
		clips: [{
			...fixture().clips[0]!, id: 'linked-clip', avLinkId: 'av-link',
		}],
	});
	assert.throws(
		() => assertMixRenderPreflight(project, [locked], normalizeMixRenderOptions()),
		/locked/iu,
	);
	assert.throws(
		() => assertMixRenderPreflight(project, [linked], normalizeMixRenderOptions()),
		/linked A\/V/iu,
	);
	const groupedOnly = track({ id: 'grouped-only', laneGroupId: 'av-lanes', clipIds: ['mono-clip'] });
	assert.throws(
		() => assertMixRenderPreflight(project, [groupedOnly], normalizeMixRenderOptions()),
		/track lanes/iu,
	);
	assert.doesNotThrow(() => assertMixRenderPreflight(
		project,
		[locked, linked],
		normalizeMixRenderOptions({
			mixDown: true, renderEffects: true, replaceOriginals: false,
		}),
	));
});

function fixture(overrides: Partial<ControllerProject> = {}): ControllerProject {
	return {
		schemaVersion: 17,
		id: 'project',
		title: 'Project',
		sampleRate: 48_000,
		tracks: [],
		clips: [{
			id: 'mono-clip', sourceId: 'mono-source', title: 'Mono',
			timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: 4, durationFrames: 4,
		}],
		sources: [{
			id: 'mono-source', storageKey: 'mono-source', name: 'Mono', mimeType: 'audio/wav',
			frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		}],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] },
		mixer: { groups: [], sends: [], routes: {} },
		trackFolders: [],
		...overrides,
	};
}

function track(overrides: Partial<ControllerTrack>): ControllerTrack {
	return {
		id: 'track', name: 'Track', type: 'audio', clipIds: [], effects: [],
		gain: 1, pan: 0, mute: false, solo: false, armed: false,
		...overrides,
	};
}
