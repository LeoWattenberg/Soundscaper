/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { updateSoundscaperRoutingNode } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';

for (const busType of ['group', 'send'] as const) for (const channels of [2, 1, 6]) {
	test(`own DAWproject round trip retains an authored ${channels}-channel ${busType} bus`, () => {
		const initial = createSoundscaperProject({ id: 'programme', tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
		const withBus = applySoundscaperProjectCommand(initial, { type: 'mixer/bus-add', busType,
			bus: { id: 'programme-bus', name: 'Programme bus' } });
		const collection = busType === 'group' ? 'groups' : 'sends';
		const candidate = updateSoundscaperRoutingNode(withBus, withBus.mixer, collection, 'programme-bus',
			{ name: 'Programme bus', channelCount: channels });
		const resized = createSoundscaperProject({ ...withBus, mixer: candidate.graph });
		const project = applySoundscaperProjectCommand(resized, { type: 'mixer/route-update', trackId: 'voice',
			changes: busType === 'group' ? { groupId: 'programme-bus' } : { sends: { 'programme-bus': 0.5 } } });
		assert.equal(validateSoundscaperProject(project), true);
		assert.equal(project.mixer[collection][0]?.channelCount, channels);
		const original = structuredClone(project);
		const exported = createDawprojectExport({ project });
		const document = parseDawprojectDocument(exported.projectXml, exported.metadataXml);
		const channel = document.tracks.find(track => track.name === 'Programme bus')?.channel;
		assert.equal(channel?.audioChannels, channels);
		let ordinal = 0;
		const plan = buildDawprojectProject(document, { media: new Map(), createStableId: prefix => `${prefix}-${++ordinal}` });
		const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project), plan.routingContext);
		assert.equal(validateSoundscaperProject(imported), true);
		assert.equal(imported.mixer[collection][0]?.channelCount, channels);
		assert.deepEqual(imported.mixer.edges.find(edge => edge.source.kind === 'mixer-node')?.channelMap,
			channels === 1 ? [0, 0] : [0, 1]);
		const connection = imported.mixer.edges.find(edge => edge.destination.kind === 'mixer-node');
		assert.equal(connection?.kind, busType === 'group' ? 'assignment' : 'send');
		assert.equal(connection?.channelMap.length, channels);
		assert.deepEqual(project, original);
	});
}
