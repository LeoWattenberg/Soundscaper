/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

function fixture(firstType: 'group' | 'send') {
	const source = createAudioSource({ id: 'take', name: 'Take.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 });
	let project = createSoundscaperProject({ id: 'bus-delivery', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: firstType, bus: { id: 'first', name: 'First' } });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'second', name: 'Second' } });
	const mixer = normalizeMixerGraphV21({ ...project.mixer, edges: project.mixer.edges.map(edge =>
		edge.source.kind === 'mixer-node' && edge.source.id === 'first'
			? { ...edge, destination: { kind: 'mixer-node', id: 'second' } } : edge) });
	return applySoundscaperProjectCommand(project, { type: 'mixer-graph/set',
		expected: project.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: mixer as unknown as Readonly<Record<string, unknown>> });
}

for (const kind of ['group', 'send'] as const) test(`DAWproject retains the ${kind} bus's authored downstream group`, () => {
	const project = fixture(kind);
	const original = structuredClone(project);
	const result = createDawprojectExport({ project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>> });
	const tracks = [...walkXml(result.document)].filter(element => element.name === 'Track');
	const first = tracks.find(element => element.attributes.name === 'First')?.children.find(element => element.name === 'Channel');
	const second = tracks.find(element => element.attributes.name === 'Second')?.children.find(element => element.name === 'Channel');
	assert.ok(first);
	assert.ok(second);
	assert.equal(first.attributes.destination, second.attributes.id);
	assert.notEqual(first.attributes.destination, second.attributes.destination);
	assert.deepEqual(project, original);
});
