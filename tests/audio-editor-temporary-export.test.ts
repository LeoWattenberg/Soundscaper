/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createStreamingZipArchive,
	createTemporaryFileSink,
	stemProject,
} from '../src/common/editor/controller/temporary-export.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createSoundscaperProjectV21,
	validateSoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts';

const copy = {
	temporaryExportClosed: 'temporary export closed',
	largeStemsStorageRequired: 'large stems require storage',
	stemArchiveClosed: 'stem archive closed',
};

async function withNavigator<Value>(
	navigatorValue: unknown,
	callback: () => Promise<Value>,
): Promise<Value> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: navigatorValue,
	});
	try {
		return await callback();
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('temporary memory sinks copy all buffer view types and reject writes after closing', async () => {
	await withNavigator({ storage: { getDirectory: async () => { throw new Error('not supported'); } } }, async () => {
		const sink = await createTemporaryFileSink('mix.wav', copy);
		assert.equal(sink.persistent, false);
		const data = Uint8Array.of(1, 2, 3, 4);
		await sink.write(data.subarray(0, 2));
		await sink.write(new DataView(data.buffer, 2, 1));
		await sink.write(Uint8Array.of(4).buffer);
		assert.throws(() => sink.writeAt(3, Uint8Array.of(5, 6)), /bytes already written/u);
		await sink.writeAt(1, Uint8Array.of(8, 7));
		data.fill(9);
		const blob = await sink.close('audio/wav');
		assert.equal(blob.type, 'audio/wav');
		assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), [1, 8, 7, 4]);
		assert.throws(() => sink.write(Uint8Array.of(5)), /temporary export closed/u);
		await assert.rejects(() => sink.close('audio/wav'), /temporary export closed/u);
		await sink.remove();
		await sink.abort();
	});
});

test('temporary persistent sinks serialize writes, close handles, and tolerate cleanup races', async () => {
	const events: string[] = [];
	const writable = {
		async write(input: Uint8Array | { position: number; data: Uint8Array }) {
			if (input instanceof Uint8Array) events.push(`write:${input[0]}`);
			else events.push(`writeAt:${input.position}:${input.data[0]}`);
		},
		async close() { events.push('close'); },
		async abort() {
			events.push('abort');
			throw new Error('already closed');
		},
	};
	const handle = {
		createWritable: async () => writable,
		getFile: async () => new Blob([Uint8Array.of(7)]),
	};
	const directory = {
		getFileHandle: async () => handle,
		async removeEntry() {
			events.push('remove');
			throw new Error('already removed');
		},
	};
	await withNavigator({
		storage: {
			getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
		},
	}, async () => {
		const sink = await createTemporaryFileSink('mix.aiff', copy);
		assert.equal(sink.persistent, true);
		const first = sink.write(Uint8Array.of(1));
		const second = sink.write(Uint8Array.of(2));
		const patch = sink.writeAt(0, Uint8Array.of(9));
		await Promise.all([first, second, patch]);
		const file = await sink.close('audio/aiff');
		assert.equal(file.size, 1);
		assert.equal(file.type, 'audio/aiff');
		await sink.remove();
		assert.deepEqual(events.slice(0, 5), ['writeAt:0:1', 'writeAt:1:2', 'writeAt:0:9', 'close', 'remove']);
	});

	await withNavigator({
		storage: {
			getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
		},
	}, async () => {
		const sink = await createTemporaryFileSink('aborted.aiff', copy);
		await sink.abort();
		assert.throws(() => sink.write(Uint8Array.of(1)), /temporary export closed/u);
	});
	assert.equal(events.includes('abort'), true);
});

test('streaming ZIP archives accept blobs and typed bytes, then become immutable', async () => {
	await withNavigator({ storage: {} }, async () => {
		const archive = await createStreamingZipArchive('stems.zip', 0, copy);
		await archive.add('blob.raw', new Blob([Uint8Array.of(1, 2, 3)]));
		await archive.add('empty.raw', new Uint8Array(0));
		await archive.add('view.raw', new DataView(Uint8Array.of(4, 5).buffer));
		const first = await archive.finish();
		const second = await archive.finish();
		assert.equal(second, first);
		assert.deepEqual(Array.from(new Uint8Array(await first.blob.arrayBuffer()).subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
		await assert.rejects(() => archive.add('late.raw', Uint8Array.of(9)), /stem archive closed/u);
		await first.cleanup();
		await archive.abort();
	});
});

test('streaming ZIP archives require persistent storage for large stem sets', async () => {
	await withNavigator({ storage: {} }, async () => {
		await assert.rejects(
			() => createStreamingZipArchive('large.zip', 97 * 1024 ** 2, copy),
			/large stems require storage/u,
		);
	});
});

test('aborted ZIP archives reject additions and allow repeated aborts', async () => {
	await withNavigator({ storage: {} }, async () => {
		const archive = await createStreamingZipArchive('cancelled.zip', 0, copy);
		await archive.abort();
		await archive.abort();
		await assert.rejects(() => archive.add('late.raw', Uint8Array.of(1)), /stem archive closed/u);
		await assert.rejects(() => archive.finish(), /stem archive closed/u);
	});
});

test('ZIP finalization failures abort and remove partial OPFS archives', async () => {
	const events: string[] = [];
	const writable = {
		async write() { events.push('write'); },
		async close() { events.push('close'); throw new Error('OPFS close failed'); },
		async abort() { events.push('abort'); },
	};
	const directory = {
		getFileHandle: async () => ({
			createWritable: async () => writable,
			getFile: async () => new Blob(),
		}),
		async removeEntry() { events.push('remove'); },
	};
	await withNavigator({
		storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) },
	}, async () => {
		const archive = await createStreamingZipArchive('failed.zip', 0, copy);
		await archive.add('entry.raw', Uint8Array.of(1));
		await assert.rejects(() => archive.finish(), /OPFS close failed/u);
		assert.deepEqual(events.slice(-3), ['close', 'abort', 'remove']);
	});
});

test('stem snapshots isolate one track and reset master processing', () => {
	const project = {
		schemaVersion: 1 as const,
		id: 'project',
		title: 'Mix',
		revision: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		sampleRate: 48_000 as const,
		masterChannels: 2 as const,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		master: { gain: 0.5, effects: [] },
		tracks: [
			{
				id: 'lead', name: 'Lead', gain: 1, pan: 0, mute: true, solo: true,
				armed: false, effects: [], clipIds: [],
			},
			{
				id: 'drums', name: 'Drums', gain: 1, pan: 0, mute: false, solo: true,
				armed: false, effects: [], clipIds: [],
			},
		],
	};
	const snapshot = stemProject(project, 'lead');
	assert.notEqual(snapshot, project);
	assert.equal(snapshot.tracks[0]?.mute, false);
	assert.equal(snapshot.tracks[0]?.solo, false);
	assert.equal(snapshot.tracks[1]?.mute, true);
	assert.equal(snapshot.tracks[1]?.solo, false);
	assert.deepEqual(snapshot.master, { gain: 1, effects: [] });
});

test('V21 stem snapshots retain active control racks without retaining inactive master automation', () => {
	const project = productionStemProject();
	const snapshot = stemProject(project as never, 'voice') as unknown as typeof project;
	assert.deepEqual(snapshot.automationLanes.map(({ id }) => id), [
		'voice-gain', 'control-frequency', 'voice-sidechain-level', 'control-master-level',
	]);
	assert.equal(snapshot.mixer.edges.some(({ id }) => id === 'control-master-sidechain'), false);
	assert.equal(snapshot.mixer.edges.find(({ id }) => id === 'control-master')?.level, 1);
	assert.equal(snapshot.mixer.edges.some(({ id }) => id === 'control-voice-sidechain'), true);
	const control = snapshot.tracks.find(({ id }) => id === 'control') as { readonly effects: readonly unknown[] };
	assert.equal(control.effects.length, 1);
	assert.deepEqual(snapshot.master, {
		...(project.master as Readonly<Record<string, unknown>>),
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effectsActive: false,
		effects: [],
	});
	assert.doesNotThrow(() => validateSoundscaperProjectV21(snapshot));
});

test('a master-only V21 stem projection reconciles the features it removes', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'pcm:source', contentSha256: 'c'.repeat(64),
		frameCount: 100, sampleRate: 48_000, channelCount: 1,
	});
	const project = createSoundscaperProjectV21({
		id: 'master-only-stem', title: 'Master-only stem', now: '2026-08-20T00:00:00.000Z',
		sources: [source],
		clips: [createAudioClip({
			id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 100, sourceDurationFrames: 100,
		})],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		sequences: [{ id: 'sequence', trackIds: ['voice'] }],
		primarySequenceId: 'sequence',
		master: {
			effectsActive: true,
			effects: [{ id: 'master-filter', type: 'highpass', enabled: true, params: { frequency: 200 } }],
		},
		automationLanes: [stemLane('master-frequency', {
			kind: 'effect', strip: { kind: 'master' },
			effectId: 'master-filter', parameterId: 'frequency',
		}, 200)],
	});
	const snapshot = stemProject(project as never, 'voice') as unknown as typeof project;
	assert.deepEqual(snapshot.automationLanes, []);
	assert.doesNotThrow(() => validateSoundscaperProjectV21(snapshot));
});

function productionStemProject() {
	const source = (id: string) => createAudioSource({
		id, storageKey: `pcm:${id}`, contentSha256: id === 'voice-source' ? 'a'.repeat(64) : 'b'.repeat(64),
		frameCount: 100, sampleRate: 48_000, channelCount: 1,
	});
	const clip = (id: string, sourceId: string) => createAudioClip({
		id, sourceId, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 100, sourceDurationFrames: 100,
	});
	return createSoundscaperProjectV21({
		id: 'stem-v21', title: 'Stem V21', now: '2026-08-20T00:00:00.000Z',
		sources: [source('voice-source'), source('control-source')],
		clips: [clip('voice-clip', 'voice-source'), clip('control-clip', 'control-source')],
		tracks: [
			createAudioTrack({
				id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
				effects: [{ id: 'voice-gate', type: 'gate', enabled: true, params: { threshold: -30 } }],
			}),
			createAudioTrack({
				id: 'control', name: 'Control', clipIds: ['control-clip'],
				effects: [{
					id: 'control-filter', type: 'highpass', enabled: true, params: { frequency: 100 },
				}],
			}),
		],
		sequences: [{ id: 'sequence', trackIds: ['voice', 'control'] }],
		primarySequenceId: 'sequence',
		master: {
			effectsActive: true,
			effects: [{ id: 'master-filter', type: 'highpass', enabled: true, params: { frequency: 200 } }],
		},
		mixer: {
			schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				stemEdge('voice-master', 'assignment', { kind: 'track', id: 'voice' }, { kind: 'master' }),
				stemEdge(
					'control-master', 'assignment', { kind: 'track', id: 'control' }, { kind: 'master' }, 'pre-fader',
				),
				stemEdge('control-voice-sidechain', 'sidechain', { kind: 'track', id: 'control' }, {
					kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'voice-gate',
				}),
				stemEdge('control-master-sidechain', 'sidechain', { kind: 'track', id: 'control' }, {
					kind: 'effect-sidechain', strip: { kind: 'master' }, effectId: 'master-filter',
				}),
				stemEdge('master-main', 'assignment', { kind: 'master' }, { kind: 'output', id: 'main' }),
			],
		},
		automationLanes: [
			stemLane('voice-gain', {
				kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain',
			}, 1),
			stemLane('control-frequency', {
				kind: 'effect', strip: { kind: 'track', id: 'control' },
				effectId: 'control-filter', parameterId: 'frequency',
			}, 100),
			stemLane('master-frequency', {
				kind: 'effect', strip: { kind: 'master' },
				effectId: 'master-filter', parameterId: 'frequency',
			}, 200),
			stemLane('master-sidechain-level', {
				kind: 'edge', edgeId: 'control-master-sidechain', parameterId: 'level',
			}, 1),
			stemLane('voice-sidechain-level', {
				kind: 'edge', edgeId: 'control-voice-sidechain', parameterId: 'level',
			}, 1),
			stemLane('control-master-level', {
				kind: 'edge', edgeId: 'control-master', parameterId: 'level',
			}, 1),
		],
	});
}

function stemEdge(
	id: string,
	kind: string,
	source: unknown,
	destination: unknown,
	position = 'post-fader',
) {
	return {
		id, kind, source, destination, position, level: 1, enabled: true, channelMap: [],
	};
}

function stemLane(id: string, address: unknown, value: number) {
	return {
		id, address, timebase: 'absolute-samples',
		points: [{ id: `${id}-start`, position: 0, value }], segments: [],
	};
}
