/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { normalizeMixerGraphV21, type MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectDocument } from '../src/common/editor/controller/document/native-project-types.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

function fixture(patch: Partial<MixerEdgeV21> = {}) {
	const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 48_000,
		frameCount: 4_800, channelCount: 2 });
	const clip = createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 4_800 });
	let project = createSoundscaperProject({ id: 'routing-delivery', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'group',
		bus: { id: 'bus', name: 'Group bus 1' } });
	const mixer = normalizeMixerGraphV21({ ...project.mixer, edges: project.mixer.edges.map(edge =>
		edge.source.kind === 'mixer-node' && edge.source.id === 'bus' ? { ...edge, ...patch } : edge) });
	return applySoundscaperProjectCommand(project, { type: 'mixer-graph/set',
		expected: project.mixer as unknown as Readonly<Record<string, unknown>>,
		mixer: mixer as unknown as Readonly<Record<string, unknown>> });
}

for (const [field, patch] of [
	['level', { level: 10 ** (-12 / 20) }],
	['position', { position: 'pre-fader' }],
	['channelMap', { channelMap: [1, 0] }],
	['enabled', { enabled: false }],
] as const) test(`DAWproject identifies its omitted assignment ${field} at the actual connection`, () => {
	const project = fixture(patch);
	const original = structuredClone(project);
	const result = createDawprojectExport({ project: project as unknown as Readonly<Record<string, unknown>> });
	const warning = result.report.items.find(item => item.code === 'dawproject.routing-features-omitted');
	assert.ok(warning);
	assert.deepEqual(warning.scope, { kind: 'mixer-edge', id: 'assignment:mixer-node:bus:master' });
	assert.equal(warning.severity, 'warning');
	assert.equal(warning.disposition, 'omitted');
	assert.deepEqual(warning.data.features, [field]);
	assert.match(warning.message ?? '', /Group bus 1 → Master/u);
	if (field === 'level') {
		assert.equal(warning.data.level, patch.level);
		assert.match(warning.message ?? '', /−12 dB.*unity/u);
	}
	assert.deepEqual(project, original);
});

test('ordinary default routing carries no unsupported-connection warning', () => {
	const result = createDawprojectExport({ project: fixture() as unknown as Readonly<Record<string, unknown>> });
	assert.equal(result.report.items.some(item => item.code === 'dawproject.routing-features-omitted'), false);
});

test('the concrete routing warning is published before preparing the user save target', async () => {
	const project = fixture({ level: 10 ** (-12 / 20) });
	let prepared = false;
	const state: { deliveryReport?: DeliveryReport } = {};
	const native = createFixture({ getProject: () => project as unknown as NativeProjectDocument,
		fileService: { isDesktop: false, prepareSave: async () => {
			prepared = true;
			const warning = state.deliveryReport?.items.find(item => item.code === 'dawproject.routing-features-omitted');
			assert.match(warning?.message ?? '', /Group bus 1 → Master.*−12 dB.*unity/u);
			return { mode: 'cancelled', fileName: 'Session.dawproject', target: null };
		} } });
	native.replaceProject(project.id);
	native.runtime.publishDocumentSnapshot = () => {
		state.deliveryReport = (native.runtime.state as { deliveryReport?: DeliveryReport }).deliveryReport;
	};
	await assert.rejects(createNativeProjectService(native.runtime).saveDawproject(), /cancelled/u);
	assert.equal(prepared, true);
});
