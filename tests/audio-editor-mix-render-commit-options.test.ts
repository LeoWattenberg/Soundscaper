/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareMixRenderOperationCommit,
} from '../src/common/editor/controller/mix-render-commit.ts';
import { normalizeMixRenderOptions } from '../src/common/editor/controller/mix-render-options.ts';
import type {
	ControllerProject,
	ControllerSource,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';

test('all six Mix and Render combinations produce one atomic command', () => {
	for (const mixDown of [true, false]) {
		for (const renderEffects of [true, false]) {
			if (!mixDown && !renderEffects) continue;
			for (const replaceOriginals of [true, false]) {
				const project = fixture();
				const targets = project.tracks as readonly ControllerTrack[];
				let sequence = 0;
				const outputs = mixDown
					? [output(targets, source('combined'))]
					: targets.map((track, index) => output([track], source(`individual-${String(index)}`)));
				const prepared = prepareMixRenderOperationCommit(project, outputs, normalizeMixRenderOptions({
					mixDown, renderEffects, replaceOriginals,
				}), { createId: (prefix) => `${prefix}-${++sequence}` });

				assert.equal(prepared.command.type, 'batch');
				assert.equal(prepared.command.commands.filter(({ type }) => type === 'selection/set').length, 1);
				assert.equal(prepared.results.length, mixDown ? 1 : 2);
				assert.equal(prepared.results[0]?.sourceId, outputs[0]?.source.id);
				assert.equal(
					prepared.command.commands.filter(({ type }) => type === 'track/remove').length,
					mixDown && replaceOriginals ? 2 : 0,
				);
				assert.equal(
					prepared.command.commands.filter(({ type }) => type === 'track/add').length,
					mixDown || !replaceOriginals ? (mixDown ? 1 : 2) : 0,
				);
			}
		}
	}
});

test('individual replacement bakes controls and effects while preserving track identities', () => {
	const project = fixture();
	let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(
		project,
		(project.tracks as readonly ControllerTrack[]).map((track, index) => (
			output([track], source(`render-${String(index)}`))
		)),
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: true }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	);
	assert.deepEqual(prepared.results.map(({ trackId }) => trackId), ['first', 'second']);
	assert.equal(prepared.command.commands.filter(({ type }) => type === 'effect/remove').length, 2);
	const updates = prepared.command.commands.filter((command) => command.type === 'track/update');
	assert.deepEqual(updates.map(({ changes }) => changes), [
		{ gain: 1, pan: 0, mute: false, solo: false, armed: false, envelope: [] },
		{ gain: 1, pan: 0, mute: false, solo: false, armed: false, envelope: [] },
	]);
});

test('individual sibling outputs retain legacy destinations but no live processing', () => {
	const project = fixture();
	let sequence = 0;
	const prepared = prepareMixRenderOperationCommit(
		project,
		(project.tracks as readonly ControllerTrack[]).map((track, index) => (
			output([track], source(`render-${String(index)}`))
		)),
		normalizeMixRenderOptions({ mixDown: false, renderEffects: true, replaceOriginals: false }),
		{ createId: (prefix) => `${prefix}-${++sequence}` },
	);
	const additions = prepared.command.commands.filter((command) => command.type === 'track/add');
	assert.equal(additions.length, 2);
	for (const addition of additions) if (addition.type === 'track/add') {
		assert.equal(addition.track.gain, 1);
		assert.equal(addition.track.pan, 0);
		assert.deepEqual(addition.track.effects, []);
	}
	const routes = prepared.command.commands.filter((command) => command.type === 'mixer/route-update');
	assert.deepEqual(routes.map(({ changes }) => changes), [
		{ groupId: 'group', sends: { send: 0.5 } },
		{ groupId: null, sends: {} },
	]);
});

function fixture(): ControllerProject {
	return {
		schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		tracks: [
			track('first', 'first-clip', { gain: 0.5, pan: -0.25 }),
			track('second', 'second-clip', { gain: 0.75, pan: 0.25 }),
		],
		clips: [clip('first-clip', 'first-source'), clip('second-clip', 'second-source')],
		sources: [source('first-source'), source('second-source')],
		selection: { startFrame: 2, endFrame: 3, trackIds: ['first', 'second'], clipIds: [] },
		mixer: {
			groups: [{ id: 'group', effects: [] }], sends: [{ id: 'send', effects: [] }],
			routes: {
				first: { groupId: 'group', sends: { send: 0.5 } },
				second: { groupId: null, sends: {} },
			},
		},
		trackFolders: [],
	};
}

function output(targetTracks: readonly ControllerTrack[], renderedSource: ControllerSource) {
	return { targetTracks, source: renderedSource, startFrame: 0, name: 'Rendered' };
}

function track(id: string, clipId: string, overrides: Partial<ControllerTrack>): ControllerTrack {
	return {
		id, name: id, type: 'audio', clipIds: [clipId], gain: 1, pan: 0,
		mute: false, solo: false, armed: false,
		effects: [{ id: `${id}-effect`, type: 'highpass' }],
		envelope: [{ frame: 0, value: 1 }], ...overrides,
	};
}

function clip(id: string, sourceId: string) {
	return {
		id, sourceId, title: id, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 4, durationFrames: 4,
	};
}

function source(id: string): ControllerSource {
	return {
		id, storageKey: id, name: id, mimeType: 'audio/wav', frameCount: 4,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
	};
}
