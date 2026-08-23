/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import {
	applyFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-commands.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-history.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('removing an audio track prunes only dependent V27 routes, VCA members, and lanes', () => {
	const project = projectWithCustomAudio();
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		type: 'track/remove', trackId: 'audio-track',
	}, { now: '2026-08-23T16:00:00.000Z' });
	assert.equal((applied.tracks as readonly Readonly<Record<string, unknown>>[])
		.some(({ id }) => id === 'audio-track'), false);
	assert.equal(applied.mixer.groups[0]?.id, 'dialogue-group');
	assert.equal(applied.mixer.outputs[0]?.name, 'Programme');
	assert.deepEqual(applied.mixer.vcas[0]?.members, [{ kind: 'master' }]);
	assert.deepEqual(applied.mixer.edges.map(({ id }) => id), [
		'assignment:master:output:main', 'assignment:group:dialogue-group:master',
	]);
	assert.deepEqual(applied.automationLanes.map(({ id }) => id), [
		'automation-master-gain', 'automation-master-output-level',
	]);
});

test('adding an audio track preserves custom finishing and adds only its default route', () => {
	const project = projectWithCustomAudio();
	const applied = applyFramescaperProjectCommandV27(PROFILE, project, {
		...createAddTrackCommand({
			type: 'audio', id: 'voiceover-track', name: 'Voiceover', armed: false,
		}),
		index: 2,
	});
	assert.equal(applied.mixer.groups[0]?.id, 'dialogue-group');
	assert.equal(applied.mixer.outputs[0]?.name, 'Programme');
	assert.equal(applied.automationLanes.length, 4);
	assert.deepEqual(applied.mixer.edges.map(({ id }) => id), [
		'assignment:track:audio-track:dialogue-group',
		'assignment:master:output:main',
		'assignment:group:dialogue-group:master',
		'assignment:track:voiceover-track:master',
	]);
});

test('track-removal audio reconciliation is one-step undoable and redoable', () => {
	const project = projectWithCustomAudio();
	const original = audioSnapshot(project);
	const executed = executeFramescaperProjectCommandV27(
		PROFILE,
		createFramescaperProjectHistoryV27(PROFILE, project),
		{ type: 'track/remove', trackId: 'audio-track' },
		{ now: '2026-08-23T16:01:00.000Z' },
	);
	assert.equal(executed.present.automationLanes.length, 2);
	const undone = undoFramescaperProjectCommandV27(PROFILE, executed, {
		now: '2026-08-23T16:02:00.000Z',
	});
	assert.deepEqual(audioSnapshot(undone.present), original);
	const redone = redoFramescaperProjectCommandV27(PROFILE, undone, {
		now: '2026-08-23T16:03:00.000Z',
	});
	assert.equal(redone.present.automationLanes.length, 2);
	assert.equal(redone.present.mixer.outputs[0]?.name, 'Programme');
});

test('an inherited batch reconciles dependent audio state once without erasing custom state', () => {
	const applied = applyFramescaperProjectCommandV27(PROFILE, projectWithCustomAudio(), {
		type: 'batch',
		commands: [
			{ type: 'track/remove', trackId: 'audio-track' },
			{ type: 'project/rename', title: 'Picture only' },
		],
	});
	assert.equal(applied.title, 'Picture only');
	assert.equal(applied.mixer.groups[0]?.id, 'dialogue-group');
	assert.equal(applied.mixer.outputs[0]?.name, 'Programme');
	assert.deepEqual(applied.automationLanes.map(({ id }) => id), [
		'automation-master-gain', 'automation-master-output-level',
	]);
});

function projectWithCustomAudio() {
	const baseline = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const mixer = structuredClone(baseline.mixer) as unknown as MutableMixerFixture;
	mixer.groups.push({
		id: 'dialogue-group', name: 'Dialogue', color: '#336699', gain: 0.8, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [],
		channelCount: 2,
	});
	mixer.outputs[0]!.name = 'Programme';
	mixer.edges[0]!.id = 'assignment:track:audio-track:dialogue-group';
	mixer.edges[0]!.destination = { kind: 'mixer-node', id: 'dialogue-group' };
	mixer.edges.push({
		id: 'assignment:group:dialogue-group:master', kind: 'assignment',
		source: { kind: 'mixer-node', id: 'dialogue-group' }, destination: { kind: 'master' },
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
	});
	mixer.vcas.push({
		id: 'dialogue-vca', name: 'Dialogue VCA', gain: 1, mute: false,
		members: [{ kind: 'track', id: 'audio-track' }, { kind: 'master' }],
	});
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(),
		finishing: {
			mixer,
			automationLanes: [
				lane('automation-master-gain', {
					kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain',
				}),
				lane('automation-track-gain', {
					kind: 'strip', strip: { kind: 'track', id: 'audio-track' }, parameterId: 'gain',
				}),
				lane('automation-track-edge-level', {
					kind: 'edge', edgeId: 'assignment:track:audio-track:dialogue-group',
					parameterId: 'level',
				}),
				lane('automation-master-output-level', {
					kind: 'edge', edgeId: 'assignment:master:output:main', parameterId: 'level',
				}),
			],
		},
	});
}

function lane(id: string, address: Readonly<Record<string, unknown>>) {
	return {
		id, address, timebase: 'absolute-samples',
		points: [{ id: `${id}:point`, position: 0, value: 1 }], segments: [],
	};
}

function audioSnapshot(project: ReturnType<typeof projectWithCustomAudio>) {
	return structuredClone({ automationLanes: project.automationLanes, mixer: project.mixer });
}

interface MutableMixerFixture {
	readonly schemaVersion: 1;
	readonly groups: Array<Record<string, unknown>>;
	readonly sends: Array<Record<string, unknown>>;
	readonly cues: Array<Record<string, unknown>>;
	readonly vcas: Array<Record<string, unknown>>;
	readonly outputs: Array<Record<string, unknown>>;
	readonly edges: Array<Record<string, unknown>>;
}
