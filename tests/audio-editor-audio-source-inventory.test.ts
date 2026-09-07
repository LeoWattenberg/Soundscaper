/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import { createProjectVisualService } from '../src/common/editor/controller/project-visual-service.ts';
import type { NativeAup4Client, NativeProjectDocument } from '../src/common/editor/controller/native-project-types.ts';
import { createFixture, project } from './helpers/native-project-service-fixture.ts';

test('AUP4 save streams only audio PCM while retaining mixed-media compatibility reporting', async () => {
	const snapshot: NativeProjectDocument = {
		...project(),
		sources: [
			{ id: 'cached', storageKey: 'cached', name: 'Cached', mimeType: 'audio/wav', frameCount: 2, channelCount: 1, sampleRate: 48_000 },
			{ id: 'stored', storageKey: 'stored', name: 'Stored', mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000 },
			{ kind: 'video', id: 'video', storageKey: 'video', name: 'Video', mimeType: 'video/mp4', sampleRate: 48_000 },
			{ kind: 'image', id: 'image', name: 'Image', mimeType: 'image/png', storageKey: 'image' },
		],
		clips: [
			{ id: 'cached-clip', sourceId: 'cached' },
			{ id: 'stored-clip', sourceId: 'stored' },
			{ id: 'video-clip', kind: 'video', sourceId: 'video' },
			{ id: 'image-clip', kind: 'image', sourceId: 'image' },
		],
	};
	const staged: string[] = [];
	const streamed: string[] = [];
	let initializeCalls = 0;
	const client: NativeAup4Client = {
		initialize: async () => { initializeCalls += 1; return { opfs: true }; },
		create: async (id) => { staged.push(`create:${id}`); },
		openFile: async () => ({ readOnly: false }),
		decode: async () => ({ project: snapshot, sources: [] }),
		async writeSnapshot(_id, _project, sources, options) {
			assert.equal(options.opfs, true);
			for await (const source of sources) {
				streamed.push(source.sourceId);
				assert.ok(source.channels[0].length > 0);
			}
			return { compatibilityReport: { items: [] } };
		},
		commit: async (id) => { staged.push(`commit:${id}`); },
		export: async (_id, options) => {
			options.onProgress({ value: 1.5 });
			return { bytes: Uint8Array.of(1, 2), validation: { valid: true } };
		},
		inspect: async () => { throw new Error('inline validation should be reused'); },
		delete: async (id) => { staged.push(`delete:${id}`); },
	};
	const fixture = createFixture({
		getProject: () => snapshot,
		initialAup4Client: client,
		createAup4Client: () => { throw new Error('initial client should be reused'); },
		sourceBuffers: new Map([['cached', {
			numberOfChannels: 1,
			getChannelData: () => Float32Array.of(0.25, -0.25),
		}]]),
		loadStoredSourceChannels: async (_store, source) => (
			source.id === 'stored' ? [Float32Array.of(0.5)] : null
		),
	});
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.saveAup4({ fileName: 'mix', useFileSystemAccess: false });

	assert.deepEqual(streamed, ['cached', 'stored']);
	assert.deepEqual(staged, [
		'create:aup4-export-native',
		'commit:aup4-export-native',
		'delete:aup4-export-native',
	]);
	assert.equal(initializeCalls, 1);
	assert.equal(result.cancelled, undefined);
	assert.equal(fixture.state.saveState, 'saved');
	assert.equal(fixture.metadata.get('project-a')?.aup4CompatibilityReportDismissed, false);
	assert.ok(fixture.statuses.some(({ message }) => message === 'Saving 100%'));
});

test('audio-only missing-source checks exclude images and preserve legacy audio', () => {
	const service = createProjectVisualService({
		getProject: () => null, captureProject: id => id, assertProject() {},
		missingSourceIds: new Set(['missing']), sourceBuffers: new Map(), sourcePeaks: new Map(), waveformPcmWindows: new Map(),
		store: { loadMediaAsset: async () => null, listVideoDerivatives: async () => [], loadVideoDerivative: async () => null },
		projectDurationFrames: () => 0, url: { createObjectURL: () => null, revokeObjectURL() {} },
	});
	for (const kind of ['audio', 'video', 'image', undefined]) {
		const inventory = { sources: [{ id: 'missing', kind }], clips: [{ sourceId: 'missing', kind }] };
		assert.equal(service.hasMissingTimelineSources(inventory), true);
		assert.equal(service.hasMissingTimelineSources(inventory, { audioOnly: true }), kind === 'audio' || kind === undefined);
	}
});
