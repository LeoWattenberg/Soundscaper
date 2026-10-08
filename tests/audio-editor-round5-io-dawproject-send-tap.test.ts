/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

function fixture(position: 'pre-fader' | 'post-fader') {
	const source = createAudioSource({ id: 'source', name: 'Tone.wav', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	let project = createSoundscaperProject({ id: 'send-project', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: 0.001, clipIds: ['clip'] })] });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'send', bus: { id: 'aux', name: 'Aux' } });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/route-update', trackId: 'voice', changes: { sends: { aux: 0.5 } } });
	const mixer = normalizeMixerGraphV21({ ...project.mixer,
		edges: project.mixer.edges.map(edge => edge.kind === 'send' ? { ...edge, position } : edge) });
	return applySoundscaperProjectCommand(project, { type: 'mixer-graph/set',
		expected: project.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: mixer as unknown as Readonly<Record<string, unknown>> });
}

test('opening the actual archive forwards parsed send taps through the native project adapter', async () => {
	const project = fixture('pre-fader');
	const delivered = createDawprojectExport({ project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>> });
	const samples = new Float32Array(48_000).fill(0.25);
	const file = await writeDawprojectArchive({ projectXml: delivered.projectXml, metadataXml: delivered.metadataXml,
		files: delivered.media.map(entry => ({ path: entry.path,
			blob: new Blob([encodeWav([samples], { sampleRate: 48_000, float: true }) as Uint8Array<ArrayBuffer>]) })) });
	Object.defineProperty(file, 'name', { value: 'Send.dawproject' });
	const runtime = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(runtime.runtime).openDawproject(file as Blob & { name: string });
	assert.ok(opened);
	const graph = normalizeMixerGraphV21(opened.project.mixer);
	assert.equal(graph.edges.find(edge => edge.kind === 'send')?.position, 'pre-fader');
	assert.deepEqual(runtime.switched, [opened.project.id]);
});

for (const position of ['pre-fader', 'post-fader'] as const) {
	test(`DAWproject delivers the authored ${position} tap without changing its level`, () => {
		const project = fixture(position);
		const original = structuredClone(project);
		const delivered = createDawprojectExport({ project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>> });
		const sends = [...walkXml(delivered.document)].filter(element => element.name === 'Send');
		assert.equal(sends.length, 1);
		assert.equal(sends[0]!.attributes.type, position === 'pre-fader' ? 'pre' : 'post');
		assert.equal(sends[0]!.children.find(element => element.name === 'Volume')?.attributes.value, '0.5');
		assert.deepEqual(project, original);
	});

	test(`DAWproject restores the delivered ${position} tap in the owning graph`, () => {
		const project = fixture(position);
		const delivered = createDawprojectExport({ project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>> });
		// Use the normative serialized tap here so the importer is tested independently of the writer.
		const xml = delivered.projectXml.replace(/type="post"/gu, `type="${position === 'pre-fader' ? 'pre' : 'post'}"`);
		let nextId = 0;
		const plan = buildDawprojectProject(parseDawprojectDocument(xml, delivered.metadataXml), {
			createStableId: prefix => `${prefix}-${String(++nextId)}`,
			media: new Map(delivered.media.map(entry => [entry.path, { frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }])),
		});
		const decoded = createCurrentAudioEditorProject(plan.project as never);
		const original = structuredClone(decoded);
		const restored = importSoundscaperAudacityProject(decoded, plan.routingContext);
		const sends = restored.mixer.edges.filter(edge => edge.kind === 'send');
		assert.equal(sends.length, 1);
		assert.equal(sends[0]!.position, position);
		assert.equal(sends[0]!.level, 0.5);
		assert.equal(restored.tracks[0]?.gain, 0.001);
		assert.deepEqual(decoded, original);
	});
}
