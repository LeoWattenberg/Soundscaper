/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { publishBlenderTracks, type BlenderRenderProject } from '../src/common/editor/controller/export/blender-publication.ts';
import type { BlenderBridge, BlenderBeginRequest, BlenderWriteRequest } from '../src/common/editor/blender-contract.ts';

function fixture() {
	const project: BlenderRenderProject = { id: 'project-a', title: 'Audio', revision: 2, sampleRate: 48_000,
		tracks: [{ id: 'a', type: 'audio', name: 'Voice', clipIds: ['clip-a'], mute: false, solo: true },
			{ id: 'b', type: 'audio', name: 'Music', clipIds: ['clip-b'], mute: false, solo: false }],
		clips: [{ id: 'clip-a', timelineStartFrame: 12_000, durationFrames: 24_000 },
			{ id: 'clip-b', timelineStartFrame: 0, durationFrames: 48_000 }] };
	const begins: BlenderBeginRequest[] = [];
	const writes: BlenderWriteRequest[] = [];
	const events: string[] = [];
	const bridge: BlenderBridge = { select: async () => ({ sessionId: 'session' }),
		begin: async (value) => { begins.push(value); events.push('begin'); return { publicationId: 'publication' }; },
		write: async (value) => { writes.push(value); events.push('write'); },
		commit: async () => { events.push('commit'); return { revision: 1 }; },
		abort: async () => { events.push('abort'); }, stop: async () => undefined };
	return { project, begins, writes, events, bridge };
}

test('Blender publication preserves track identity, timing, mute and solo while streaming valid WAV stems', async () => {
	const f = fixture();
	const ranges: unknown[] = [];
	await publishBlenderTracks({ getProject: () => f.project,
		stemProject: (project, trackId) => ({ ...project, tracks: project.tracks.filter(({ id }) => id === trackId) }),
		tailFrames: () => 48,
		renderSnapshot: async (_project, range) => {
			ranges.push(range);
			const frames = range.endFrame + Math.round(range.includeTail * 48_000);
			return { length: frames, numberOfChannels: 1, sampleRate: 48_000,
				getChannelData: () => new Float32Array(frames).fill(0.25) };
		},
	}, { bridge: f.bridge, sessionId: 'session', projectId: 'project-a', revision: 2 });
	assert.deepEqual(f.begins[0]?.tracks.map(({ id, startSeconds, durationSeconds, mute }) => ({ id, startSeconds, durationSeconds, mute })),
		[{ id: 'a', startSeconds: 0, durationSeconds: 1.001, mute: false },
			{ id: 'b', startSeconds: 0, durationSeconds: 1.001, mute: true }]);
	assert.deepEqual(ranges, Array.from({ length: 2 }, () => ({ startFrame: 0, endFrame: 48_000, includeTail: .001, includeMaster: false, respectMuteSolo: true })));
	assert.equal(f.events.at(-1), 'commit');
	for (const trackId of ['a', 'b']) {
		const chunks = f.writes.filter((write) => write.trackId === trackId);
		assert.equal(new TextDecoder().decode(chunks[0]?.bytes.slice(0, 4)), 'RIFF');
		let offset = 0;
		for (const chunk of chunks) { assert.equal(chunk.offset, offset); assert.ok(chunk.bytes.byteLength <= 4 * 1024 * 1024); offset += chunk.bytes.byteLength; }
		assert.equal(offset, 44 + 48_048 * 3);
	}
});

test('a project edit during rendering aborts the publication before exposing stale stems', async () => {
	const f = fixture();
	const current = { ...f.project };
	await assert.rejects(publishBlenderTracks({ getProject: () => current,
		stemProject: (project) => project, tailFrames: () => 0,
		renderSnapshot: async () => { current.revision += 1; return { length: 1, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => Float32Array.of(0) }; },
	}, { bridge: f.bridge, sessionId: 'session', projectId: 'project-a', revision: 2 }), { name: 'AbortError' });
	assert.deepEqual(f.events, ['begin', 'abort']);
});

test('Blender publication can atomically clear the exported timeline', async () => {
	const f = fixture();
	await publishBlenderTracks({ getProject: () => ({ ...f.project, tracks: [] }),
		stemProject: (project) => project, tailFrames: () => 0,
		renderSnapshot: async () => { throw new Error('No audio should render'); },
	}, { bridge: f.bridge, sessionId: 'session', projectId: 'project-a', revision: 2 });
	assert.deepEqual(f.begins[0]?.tracks, []);
	assert.deepEqual(f.events, ['begin', 'commit']);
});

test('Blender publication refuses mismatched rendered geometry before writing an inconsistent stem', async () => {
	const f = fixture();
	await assert.rejects(publishBlenderTracks({ getProject: () => f.project,
		stemProject: (project) => project, tailFrames: () => 0,
		renderSnapshot: async () => ({ length: 1, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => Float32Array.of(0) }),
	}, { bridge: f.bridge, sessionId: 'session', projectId: 'project-a', revision: 2 }), /published audio duration/u);
	assert.deepEqual(f.events, ['begin', 'abort']);
});

test('Blender track capacity is checked before preparing or publishing any stems', async () => {
	const f = fixture();
	const project = { ...f.project, tracks: Array.from({ length: 129 }, (_, index) => ({
		...f.project.tracks[0]!, id: `track-${String(index)}`,
	})) };
	await assert.rejects(publishBlenderTracks({ getProject: () => project,
		stemProject: () => { throw new Error('No stem should be prepared'); },
		renderSnapshot: async () => { throw new Error('No stem should render'); },
	}, { bridge: f.bridge, sessionId: 'session', projectId: 'project-a', revision: 2 }), /at most 128 audio tracks/u);
	assert.deepEqual(f.events, []);
});
