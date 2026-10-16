/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAraClipEditingRuntime } from '../src/common/editor/controller/effects/internal/ara-clip-editing.ts';
import { resolveAraClipEditingRuntime } from '../src/common/editor/ara-clip-editing-runtime.ts';
import { createAraApplicationMenuItems } from '../src/common/editor/ui/ara-application-menu.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';

for (const productId of ['soundscaper', 'framescaper'] as const) {
	void test(`${productId} ARA clips publish one muted render without changing the original`, async () => {
		const host = fixture(productId);
		const original = structuredClone(host.project());
		const prepared = await host.runtime.prepare();
		assert.deepEqual(host.renderCalls, [{ trackId: 'original-track', startFrame: 100,
			endFrame: 580, channelCount: 2, clipIds: ['original-clip'] }]);
		assert.equal(prepared.sourceId, 'original-source');
		assert.equal(prepared.frameCount, 480);
		assert.equal(prepared.sampleRate, 48_000);
		assert.equal(prepared.sourceStartSeconds, 0);
		assert.equal(prepared.playbackStartSeconds, 100 / 48_000);
		assert.equal(prepared.durationSeconds, 480 / 48_000);
		prepared.channels[0]![0] = 0.75;
		assert.equal(host.rendered[0]![0], 0.25, 'native upload owns PCM separately from renderer caches');
		const published = await prepared.apply({ channels: host.result, sampleRate: 48_000, name: 'ARA vocal' });
		const project = projectForCommandConsumers(host.project());
		assert.equal(host.commits.length, 1);
		assert.equal(host.commits[0]?.type, 'batch');
		assert.deepEqual(host.project().clips[0], original.clips[0]);
		assert.deepEqual(host.project().sources[0], original.sources[0]);
		assert.deepEqual(host.project().tracks[0], original.tracks[0]);
		assert.equal(project.tracks.find(({ id }) => id === published.trackId)?.mute, true);
		const clip = project.clips.find(({ id }) => id === published.clipId);
		assert.equal(clip?.timelineStartFrame, 100);
		assert.equal(clip?.sourceStartFrame, 0);
		assert.equal(clip?.durationFrames, 480);
		assert.equal(clip?.gain, 1, 'the prepared clip already includes authored clip gain');
		assert.equal(clip?.avLinkId, null);
		assert.deepEqual(host.saved.get(published.sourceId), host.result);
		assert.deepEqual(host.activated, [published.sourceId], 'the rendered source is playable before publication');
		await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 48_000 }), /closed|completed/u);
	});
}

for (const productId of ['soundscaper', 'framescaper'] as const) {
	for (const condition of ['locked', 'four-channel'] as const) void test(`${productId} ARA menu admits only the selected clip its native preparation supports (${condition})`, async () => {
		const host = fixture(productId);
		const healthy = await host.runtime.prepare();
		healthy.cancel();
		let opens = 0;
		const item = () => createAraApplicationMenuItems({ productId, available: true,
			project: host.project(), selectedClipId: host.selection.clipId,
			editingBlocked: false, readOnly: false }, () => { opens += 1; })[0];
		assert.equal(item()?.disabled, false);
		item()?.onClick?.();
		assert.equal(opens, 1);
		const blocked = condition === 'locked' ? host : fixture(productId, { channelCount: 4 });
		if (condition === 'locked') host.replaceProject({ ...host.project(),
			tracks: host.project().tracks.map(track => ({ ...track, locked: true })) });
		await assert.rejects(blocked.runtime.prepare(), condition === 'locked' ? /locked/u : /mono\/stereo/u);
		const refused = createAraApplicationMenuItems({ productId, available: true,
			project: blocked.project(), selectedClipId: blocked.selection.clipId,
			editingBlocked: false, readOnly: false }, () => { opens += 1; })[0];
		assert.equal(refused?.disabled, true, 'the actual canonical preparation has already refused this native clip');
		assert.equal(refused?.onClick, undefined);
	});
}

void test('ARA rejects invalid selection, locked tracks and excessive decoded PCM before rendering', async () => {
	const host = fixture('framescaper');
	host.selection.clipId = null;
	await assert.rejects(host.runtime.prepare(), /Select an audio clip/u);
	host.selection.clipId = 'original-clip';
	host.selection.blocked = true;
	await assert.rejects(host.runtime.prepare(), /read-only|busy/u);
	host.selection.blocked = false;
	host.replaceProject({ ...host.project(), tracks: host.project().tracks.map(track => ({ ...track, locked: true })) });
	await assert.rejects(host.runtime.prepare(), /locked/u);
	assert.equal(host.renderCalls.length, 0);
	const limited = fixture('soundscaper', { maximumPcmBytes: 1 });
	await assert.rejects(limited.runtime.prepare(), /decoded audio limit/u);
	assert.equal(limited.renderCalls.length, 0);
});

void test('ARA retains mono geometry without introducing a stereo channel', async () => {
	const host = fixture('framescaper', { channelCount: 1 });
	const prepared = await host.runtime.prepare();
	assert.equal(prepared.channelCount, 1);
	const publication = await prepared.apply({ channels: host.result, sampleRate: prepared.sampleRate });
	assert.equal(host.project().sources.find(({ id }) => id === publication.sourceId)?.channelCount, 1);
});

void test('ARA refuses pre-aborted renders and superseded prepared operations', async () => {
	const host = fixture('soundscaper');
	const first = await host.runtime.prepare();
	const second = await host.runtime.prepare();
	assert.throws(() => first.assertCurrent());
	second.cancel();
	const external = new AbortController();
	external.abort(new Error('user cancelled'));
	await assert.rejects(host.runtime.prepare({ signal: external.signal }), /user cancelled/u);
	assert.equal(host.saved.size, 0);
});

void test('ARA rejects edited selections, project switches, cancellation and controller disposal', async () => {
	for (const invalidate of ['selection', 'project', 'cancel', 'dispose'] as const) {
		const host = fixture('soundscaper');
		const prepared = await host.runtime.prepare();
		if (invalidate === 'selection') host.selection.clipId = null;
		if (invalidate === 'project') host.generation.activate('another-project');
		if (invalidate === 'cancel') prepared.cancel();
		if (invalidate === 'dispose') host.lifetime.beginDisposal();
		await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 48_000 }));
		assert.equal(host.saved.size, 0);
		assert.equal(host.commits.length, 0);
	}
});

void test('ARA rejects changed output geometry and nonfinite PCM before persistence', async () => {
	const host = fixture('soundscaper');
	const prepared = await host.runtime.prepare();
	await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 44_100 }), /geometry/u);
	await assert.rejects(prepared.apply({ channels: [host.result[0]!], sampleRate: 48_000 }), /geometry/u);
	const invalid = host.result.map(channel => channel.slice());
	invalid[0]![2] = Number.NaN;
	await assert.rejects(prepared.apply({ channels: invalid, sampleRate: 48_000 }), /finite/u);
	assert.equal(host.saved.size, 0);
});

void test('ARA rolls back written PCM when the selection changes during storage', async () => {
	const host = fixture('framescaper');
	const prepared = await host.runtime.prepare();
	host.onWrite = () => { host.selection.clipId = null; };
	await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 48_000 }));
	assert.equal(host.saved.size, 0);
	assert.equal(host.commits.length, 0);
	assert.equal(host.aborts.length, 1);
});

void test('ARA rolls back retained PCM if the atomic document commit refuses it', async () => {
	const host = fixture('soundscaper');
	const prepared = await host.runtime.prepare();
	host.commitFailure = new Error('commit refused');
	await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 48_000 }), /commit refused/u);
	assert.equal(host.saved.size, 0);
	assert.equal(host.deleted.length, 1);
	assert.deepEqual(host.released, host.activated, 'rollback retires playback and waveform runtime');
});

void test('ARA removes retained audio when playback source activation fails', async () => {
	const host = fixture('framescaper');
	const prepared = await host.runtime.prepare();
	host.onActivate = () => { throw new Error('source activation failed'); };
	await assert.rejects(prepared.apply({ channels: host.result, sampleRate: 48_000 }), /source activation failed/u);
	assert.equal(host.saved.size, 0);
	assert.equal(host.commits.length, 0);
	assert.deepEqual(host.released, host.activated);
});

void test('ARA runtime resolves only an exact controller-owned preparation port', () => {
	const runtime = fixture('soundscaper').runtime;
	assert.equal(resolveAraClipEditingRuntime({ araClipEditing: runtime }), runtime);
	assert.equal(resolveAraClipEditingRuntime({}), null);
	assert.equal(resolveAraClipEditingRuntime(null), null);
	assert.equal(resolveAraClipEditingRuntime({ araClipEditing: {} }), null);
});

function fixture(productId: 'soundscaper' | 'framescaper', configuration: Readonly<{
	channelCount?: number; maximumPcmBytes?: number;
}> = {}) {
	const channelCount = configuration.channelCount ?? 2;
	const options = { id: 'ara-project', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'original-source', name: 'Vocal', frameCount: 960, channelCount, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'original-clip', sourceId: 'original-source', title: 'Vocal',
			sourceStartFrame: 240, sourceDurationFrames: 480, timelineStartFrame: 100, durationFrames: 480, gain: 0.5 })],
		tracks: [createAudioTrack({ id: 'original-track', name: 'Vocal', clipIds: ['original-clip'] })],
	};
	let project = productId === 'soundscaper' ? createSoundscaperProject(options)
		: createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options);
	const initialSelection: AudioEditorCommand = { type: 'selection/set', startFrame: 0, endFrame: 0,
		trackIds: ['original-track'], clipIds: ['original-clip'], frequencyRange: null };
	project = productId === 'soundscaper' ? applySoundscaperProjectCommand(project, initialSelection)
		: applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, initialSelection);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate('ara-project');
	const selection = { clipId: 'original-clip' as string | null, blocked: false };
	const rendered = Array.from({ length: channelCount }, (_, channel) => new Float32Array(480).fill(channel ? 0.125 : 0.25));
	const result = Array.from({ length: channelCount }, (_, channel) => new Float32Array(480).fill(channel ? 0.375 : 0.5));
	const saved = new Map<string, Float32Array[]>();
	const renderCalls: unknown[] = [];
	const commits: AudioEditorCommand[] = [];
	const deleted: string[] = [];
	const aborts: string[] = [];
	const activated: string[] = [], released: string[] = [];
	let counter = 0;
	const host = { lifetime, generation, selection, rendered, result, saved, renderCalls, commits, deleted, aborts, activated, released,
		onWrite: null as (() => void) | null, onActivate: null as (() => void) | null, commitFailure: null as Error | null,
		project: () => project, replaceProject: (value: typeof project) => { project = value; },
		runtime: createAraClipEditingRuntime({
			maximumPcmBytes: configuration.maximumPcmBytes,
			lifetime, projectGeneration: generation,
			getProject: () => project,
			getCommandProject: () => projectForCommandConsumers(project) as unknown as EffectSelectionProject,
			getSelectedClipId: () => selection.clipId,
			editingBlocked: () => selection.blocked,
			renderClip: (trackId, startFrame, endFrame, channelCount, clipIds) => {
				renderCalls.push({ trackId, startFrame, endFrame, channelCount, clipIds });
				return Promise.resolve(rendered);
			},
			preflightStorage: () => Promise.resolve(), createId: prefix => `${prefix}-${++counter}`,
			activateSource: source => { activated.push(source.id); host.onActivate?.(); return Promise.resolve(); },
			releaseSource: sourceId => { released.push(sourceId); return Promise.resolve(); },
			store: {
				beginSourceWrite: (sourceId) => {
					const chunks: Float32Array[][] = [];
					return Promise.resolve({
						write: (channels) => { chunks.push(channels.map(channel => channel.slice())); host.onWrite?.(); },
						commit: () => { saved.set(sourceId, chunks[0]!); },
						abort: () => { aborts.push(sourceId); saved.delete(sourceId); },
					});
				},
				deleteSource: sourceId => { deleted.push(sourceId); saved.delete(sourceId); return Promise.resolve(); },
			},
			commit: (command) => {
				if (host.commitFailure) throw host.commitFailure;
				project = productId === 'soundscaper' ? applySoundscaperProjectCommand(project, command)
					: applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project, command);
				commits.push(command);
			},
		}),
	};
	return host;
}
