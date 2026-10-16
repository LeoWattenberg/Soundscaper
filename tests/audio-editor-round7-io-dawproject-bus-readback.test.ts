/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

for (const firstKind of ['group', 'send'] as const) for (const routed of [false, true]) test(`own ordinary ${firstKind} bus DAWproject readback retains ${routed ? 'downstream group' : 'direct master'} assignment`, () => {
	const source = createAudioSource({ id: 'voice', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 });
	let project = createSoundscaperProject({ id: 'normal-buses', sources: [source],
		clips: [createAudioClip({ id: 'voice-clip', sourceId: source.id, durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice-track', clipIds: ['voice-clip'] })] });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: firstKind, bus: { id: 'first', name: 'First' } });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'second', name: 'Second', gain: .25 } });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/route-update', trackId: 'voice-track',
		changes: firstKind === 'group' ? { groupId: 'first' } : { sends: { first: .5 } } });
	if (routed) {
		project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'send', bus: { id: 'aux', name: 'Aux' } });
		const mixer = normalizeMixerGraphV21({ ...project.mixer, edges: [...project.mixer.edges.map(edge =>
			edge.source.kind === 'mixer-node' && edge.source.id === 'first'
				? { ...edge, destination: { kind: 'mixer-node', id: 'second' } } : edge),
			{ id: 'authored-pre-send', kind: 'send', source: { kind: 'mixer-node', id: 'first' },
				destination: { kind: 'mixer-node', id: 'aux' }, position: 'pre-fader', level: .3, enabled: true, channelMap: [0, 1] }] });
		project = applySoundscaperProjectCommand(project, { type: 'mixer-graph/set',
			expected: project.mixer as unknown as Readonly<Record<string, unknown>>,
			mixer: mixer as unknown as Readonly<Record<string, unknown>> });
	}
	const original = structuredClone(project);
	const delivered = projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>>;
	const exported = createDawprojectExport({ project: delivered });
	const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
	let id = 0;
	const plan = buildDawprojectProject(document, { createStableId: prefix => `${prefix}:${String(++id)}`,
		media: new Map(exported.media.map(media => [media.path, { frameCount: 48_000, channelCount: 2, sampleRate: 48_000 }])) });
	const decoded = createCurrentAudioEditorProject(plan.project);
	const imported = importSoundscaperAudacityProject(decoded, plan.routingContext);
	const first = (firstKind === 'group' ? imported.mixer.groups : imported.mixer.sends).find(bus => bus.name === 'First');
	const second = imported.mixer.groups.find(bus => bus.name === 'Second');
	assert.ok(first); assert.ok(second);
	assert.equal(second.gain, .25);
	const assignment = imported.mixer.edges.find(edge => edge.source.kind === 'mixer-node'
		&& edge.source.id === first.id && edge.kind === 'assignment');
	assert.ok(assignment);
	assert.deepEqual(assignment.destination, routed ? { kind: 'mixer-node', id: second.id } : { kind: 'master' });
	if (routed) {
		const aux = imported.mixer.sends.find(bus => bus.name === 'Aux'); assert.ok(aux);
		const send = imported.mixer.edges.find(edge => edge.kind === 'send' && edge.source.kind === 'mixer-node'
			&& edge.source.id === first.id && edge.destination.kind === 'mixer-node' && edge.destination.id === aux.id);
		assert.ok(send); assert.equal(send.level, .3); assert.equal(send.position, 'pre-fader');
		assert.deepEqual(send.channelMap, [0, 1]);
	}
	assert.deepEqual(project, original);
});
