/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { BlenderExportStore } from '../desktop/blender-export-store.ts';
import type { BlenderBridge } from '../src/common/editor/blender-contract.ts';
import { publishBlenderTracks, type BlenderRenderProject } from '../src/common/editor/controller/export/blender-publication.ts';

const ADDON = resolve(import.meta.dirname, '../desktop/blender/soundscaper_blender.py');
const FIXTURE = resolve(import.meta.dirname, 'fixtures/blender-addon-contract.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

for (const [scenario, description] of [
	['validation', 'rejects unsafe paths and malformed track manifests before importing'],
	['reconcile', 'reconciles audio revisions by track identity and preserves unrelated Blender strips'],
	['legacy', 'supports Blender 4.2 sequences and fractional frame rates'],
	['channels', 'preflights Blender channel capacity before changing existing strips'],
	['connection', 'accepts only authenticated loopback connections and rejects redirects'],
	['live', 'receives real IPC updates off-thread and applies audio changes on the Blender timer'],
	['menus', 'registers import and live sync menu entries and releases sessions on unload'],
] as const) {
	test(`Blender add-on ${description}`, () => {
		const result = spawnSync(PYTHON, [FIXTURE, ADDON, scenario], {
			encoding: 'utf8', timeout: 20_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	});
}

test('Blender add-on imports and reloads actual WAV strips in a real Blender process', {
	skip: !process.env.BLENDER_EXECUTABLE && 'Set BLENDER_EXECUTABLE to run Blender integration smoke coverage.',
}, async (context) => {
	const parent = await mkdtemp(join(tmpdir(), 'soundscaper-blender-actual-'));
	const owner = {};
	const store = new BlenderExportStore({ isOwnerCurrent: (candidate) => candidate === owner, addonPath: ADDON });
	context.after(async () => {
		try { await store.dispose(); }
		finally { await rm(parent, { recursive: true, force: true }); }
	});
	const { sessionId } = await store.create(owner, parent, false);
	const bridge: BlenderBridge = {
		select: async () => ({ sessionId }), begin: (request) => store.begin(owner, request),
		write: (request) => store.write(owner, request), commit: (request) => store.commit(owner, request),
		abort: (request) => store.abort(owner, request), stop: (request) => store.stop(owner, request.sessionId),
	};
	const project: BlenderRenderProject = { id: 'actual-project', title: 'Actual export', revision: 1, sampleRate: 48_000,
		tracks: [{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['voice-clip'], mute: false },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: ['music-clip'], mute: true }],
		clips: [{ id: 'voice-clip', timelineStartFrame: 0, durationFrames: 48_000 },
			{ id: 'music-clip', timelineStartFrame: 0, durationFrames: 48_000 }] };
	await publishBlenderTracks({ getProject: () => project,
		stemProject: (source, trackId) => ({ ...source, tracks: source.tracks.filter(({ id }) => id === trackId) }),
		tailFrames: () => 0, renderSnapshot: async (_source, range) => ({ channels: [new Float32Array(range.endFrame).fill(0.25)] }),
	}, { bridge, sessionId, projectId: project.id, revision: project.revision });
	const directory = join(parent, (await readdir(parent))[0]!);
	const actualBundle = spawnSync(process.env.BLENDER_EXECUTABLE ?? 'blender', [
		'--background', '--factory-startup', '--python-exit-code', '1', '--python', FIXTURE, '--', ADDON, 'bundle', directory,
	], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
	assert.ifError(actualBundle.error);
	assert.equal(actualBundle.status, 0, `${actualBundle.stdout}\n${actualBundle.stderr}`);
	const result = spawnSync(process.env.BLENDER_EXECUTABLE ?? 'blender', [
		'--background', '--factory-startup', '--python-exit-code', '1', '--python', FIXTURE, '--', ADDON, 'real',
	], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
	assert.ifError(result.error);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
