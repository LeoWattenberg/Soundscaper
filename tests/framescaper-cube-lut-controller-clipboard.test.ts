/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createClipboardEditService, type ClipboardEditProject, type ClipboardEditState } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { bindControllerEditClipboardRuntime, resolveControllerProjectRuntime } from '../src/common/editor/controller/document/project-runtime.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import type { CurrentAudioEditorMutationCommandV2 } from '../src/common/editor/commands/clipboard-command-v2.ts';
import { prepareDuplicateSelectionCommand } from '../src/common/editor/controller/edit/internal/duplicate-selection-command.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createVideoTimingAssetPublication, validateVideoTimingAssetBytes } from '../src/common/editor/video-timing-asset.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type ControllerOptions = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const RANGE = { startFrame: 0, endFrame: 24_000, trackIds: ['video-track'] };
function projects() {
	const options = framescaperV20Options();
	const origin = createFramescaperProject(PROFILE, { ...options, clips: (options.clips as readonly Record<string, unknown>[])
		.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 0.5 } },
			{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: REF } },
		] } : clip) });
	const destination = createFramescaperProject(PROFILE, { ...options, id: 'destination', sources: [], clips: [], projectBin: { clips: [] },
		tracks: (options.tracks as readonly Record<string, unknown>[]).map(track => ({ ...track, clipIds: [] })) });
	return { origin, destination };
}
function effectsOf(clip: Readonly<Record<string, unknown>>) {
	assert.ok(Array.isArray(clip.videoEffects));
	return clip.videoEffects as readonly { id: string; type: string; enabled: boolean; params: unknown }[];
}
function pasteOf(command: CurrentAudioEditorMutationCommandV2): Extract<CurrentAudioEditorMutationCommandV2, { type: 'clipboard/paste' }> {
	if (command.type === 'clipboard/paste') return command;
	if (command.type === 'batch') for (const child of command.commands) {
		if (child.type === 'clipboard/paste') return child;
	}
	throw new Error('The prepared command must contain its complete paste.');
}

test('the current controller clipboard copies, switches tabs, closes its origin and pastes full ordered resource leaves through real Frame history', () => {
	const { origin, destination } = projects(), original = structuredClone(origin);
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	const runtime = resolveControllerProjectRuntime(selected);
	assert.equal(typeof runtime.captureEditClipboardDescriptor, 'function');
	let active = origin, ids = 0;
	const session = selected.createSessionController();
	session.openProject(origin); session.openProject(destination);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const state: ClipboardEditState = { selectedTrackId: 'video-track', selectedClipId: 'video-clip', clipboard: null };
	const service = createClipboardEditService({ lifetime, state, copy: { noSilencesFound: 'None', track: 'Track' }, session,
		getProject: () => selected.projectForCommandConsumers(active) as ClipboardEditProject,
		getPositionFrames: () => 48_000, normalizeFrame: Number, snapFrame: Number,
		editingBlocked: () => false, createId: prefix => `${prefix}-${String(++ids)}`,
		sourceBuffers: new Map(), commit: () => { throw new Error('Preparation must not publish.'); }, setStatus: () => {},
		...bindControllerEditClipboardRuntime(runtime, () => active) });
	const descriptor = runtime.captureEditClipboardDescriptor!(origin, RANGE);
	assert.equal(descriptor.schemaVersion, 7);
	const copied = service.setSessionClipboard(descriptor);
	assert.deepEqual(copied, descriptor);
	assert.equal(session.serialize().clipboard!.schemaVersion, 2);
	active = destination; session.switchProject(destination.id);
	session.closeProject(origin.id, { force: true });
	assert.deepEqual([...session.getHistoryStorageKeys()], [REF.storageKey]);
	state.selectedClipId = null;
	const prepared = service.prepareControllerPaste('overlap', 48_000);
	const paste = pasteOf(prepared);
	assert.equal(paste.clipboard.schemaVersion, 7);
	const descriptorClip = paste.clipboard.tracks[0]!.clips[0]!;
	assert.deepEqual((descriptorClip.videoEffects as readonly { params: unknown }[])[1]!.params, { lut: REF });
	const firstHistory = selected.createHistory(destination);
	const pastedHistory = selected.executeCommand(firstHistory, prepared);
	const pasted = pastedHistory.present;
	const clip = pasted.clips.find(item => item.id === paste.clipIds![descriptorClip.key as string])!;
	assert.ok(clip); assert.equal(clip.sequenceStartFrame, 10);
	const effects = effectsOf(clip);
	assert.deepEqual(effects.map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(effects.map(effect => effect.id), paste.videoEffectIds![descriptorClip.key as string]);
	assert.equal(new Set(effects.map(effect => effect.id)).size, 2);
	assert.deepEqual(effects[1]!.params, { lut: REF }); assert.equal(effects[1]!.enabled, false);
	assert.deepEqual(pasted.sources.map(source => source.id), ['video-source']);
	assert.deepEqual(origin, original);
	const undone = selected.undo(pastedHistory); assert.deepEqual(undone.present.clips, destination.clips);
	const redone = selected.redo(undone); assert.deepEqual(redone.present.clips, pasted.clips);
	assert.deepEqual(effectsOf(redone.present.clips[0]!)[1]!.params, { lut: REF });
	assert.equal(session.clearClipboard().releasedSourceIds.includes('video-source'), true);
	assert.deepEqual([...session.getHistoryStorageKeys()], []);
	session.dispose();
});

test('current Duplicate preserves the clipboard, complete disabled resources and independent effect IDs in the destination track', () => {
	const { origin } = projects(), original = structuredClone(origin);
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	let ids = 0;
	const createId = (prefix = 'id') => `${prefix}-${String(++ids)}`;
	const prepared = prepareDuplicateSelectionCommand({
		getProject: () => selected.projectForCommandConsumers(origin) as { tracks: readonly { id: string; name: string; type: string }[] },
		createStableId: createId,
		createClipboardDescriptor: (_project, options) => selected.captureEditClipboardDescriptor(origin, options),
		prepareDuplicateCommand: (descriptor, command) => selected.prepareEditDuplicateCommand(origin, descriptor, command, createId) as CurrentAudioEditorMutationCommandV2,
	}, { ...RANGE, clipIds: ['video-clip'], exactClips: true });
	assert.ok(prepared);
	const result = selected.applyCommand(origin, prepared.command);
	const added = result.clips.find(clip => clip.id === prepared.selectClipId)!;
	assert.ok(added);
	assert.deepEqual(effectsOf(added).map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(effectsOf(added)[1]!.params, { lut: REF }); assert.equal(effectsOf(added)[1]!.enabled, false);
	assert.equal(effectsOf(added).some(effect => ['tone', 'cube'].includes(effect.id)), false);
	assert.deepEqual(origin, original);
});

test('canonical clipboard bindings retain the selected runtime method receivers for capture and paste', () => {
	const { origin } = projects();
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	let captured = 0, prepared = 0;
	const owner = {
		createEditSessionClipboard(project: unknown, descriptor: Parameters<typeof selected.createEditSessionClipboard>[1]) {
			assert.equal(this, owner); captured++;
			return selected.createEditSessionClipboard(project, descriptor);
		},
		prepareEditClipboardPasteCommand(project: unknown, clipboard: unknown, command: CurrentAudioEditorMutationCommandV2,
			createId: (prefix?: string) => string) {
			assert.equal(this, owner); prepared++;
			return selected.prepareEditClipboardPasteCommand(project, clipboard, command, createId);
		},
	};
	const bound = bindControllerEditClipboardRuntime(owner, () => origin);
	const descriptor = selected.captureEditClipboardDescriptor(origin, RANGE);
	const carrier = bound.createEditSessionClipboard!(null, descriptor);
	assert.equal(carrier.descriptor.schemaVersion, 7); assert.equal(captured, 1);
	assert.throws(() => bound.prepareEditClipboardPasteCommand!(null, carrier,
		{ type: 'project/rename', title: 'Refusing non-paste' }, () => 'unused'), /exactly one|paste/iu);
	assert.equal(prepared, 1);
});

test('the real current Frame controller copies selected linked VFR A/V, creates a project and pastes complete disabled Cube custody', async () => {
	const fixture = linkedVfrCubeProject();
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	const session = selected.createSessionController();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	await store.writeMediaAsset('video-source', new Blob([fixture.original]));
	await store.writeMediaAsset(fixture.timing.reference.storageKey, new Blob([new Uint8Array(fixture.timing.bytes)]));
	await store.writeMediaAsset(fixture.ref.storageKey, new Blob([fixture.cubeBytes]));
	const samples = new Float32Array(48_000); samples[0] = 0.25; samples[47_999] = -0.5;
	const writer = await store.beginSourceWrite('audio-source', { sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 });
	await writer.write([samples]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536 });
	assert.ok(await store.createProjectIfAbsent(fixture.project));
	await store.saveSetting('framescaper:last-project-id', fixture.project.id);
	const controller = createAudioEditorController(null, {
		headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		projectRuntime: selected, sessionController: session, store,
		// The maintained headless mocks expose the ports exercised here, without media codec execution.
		engine: createMemoryEngine() as unknown as ControllerOptions['engine'],
		engineFactory: createMemoryRenderEngine as unknown as ControllerOptions['engineFactory'],
		ffmpeg: createMemoryFfmpeg() as unknown as ControllerOptions['ffmpeg'],
	});
	try {
		await controller.ready;
		assert.equal(controller.project?.id, fixture.project.id);
		controller.actions.timeline.selectClip('video-clip');
		const origin = selected.cloneProject(controller.project);
		assert.deepEqual(origin.selection.clipIds, ['video-clip', 'audio-clip']);
		assert.equal(origin.selection.startFrame, origin.selection.endFrame);
		controller.actions.edit.copy();
		const copied = session.serialize().clipboard;
		assert.ok(copied);
		assert.equal(copied.schemaVersion, 2);
		assert.equal(copied.descriptor.schemaVersion, 7);
		assert.equal(copied.descriptor.durationFrames, 48_000);
		assert.deepEqual(copied.sources.map((source: Readonly<{ id: string }>) => source.id).sort(), ['audio-source', 'video-source']);
		const copiedVideo = copied.sources.find((source: Readonly<Record<string, unknown>>) => source.id === 'video-source'); assert.ok(copiedVideo);
		assert.deepEqual(copiedVideo.timingAsset, fixture.timing.reference);
		assert.deepEqual(copiedVideo.timingDecision, fixture.videoSource.timingDecision);
		const copiedClips = copied.descriptor.tracks.flatMap((track: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>) => track.clips);
		assert.equal(copiedClips.length, 2);
		const copiedVideoClip = copiedClips.find((clip: Readonly<Record<string, unknown>>) => clip.kind === 'video'); assert.ok(copiedVideoClip);
		assert.deepEqual(effectsOf(copiedVideoClip).map(effect => [effect.type, effect.enabled, effect.params]), [
			['cube-lut-profile-v1', false, { lut: fixture.ref }],
		]);
		await controller.actions.project.create({ title: 'Copied VFR destination', sampleRate: 48_000 });
		assert.notEqual(controller.project?.id, fixture.project.id);
		assert.deepEqual(controller.project?.clips, []);
		assert.deepEqual(session.serialize().clipboard, copied);
		const paste = controller.actions.edit.paste();
		assert.ok(paste && typeof paste.then === 'function', 'Cross-project Paste must return its actual settlement promise.');
		await paste;
		const pasted = selected.cloneProject(controller.project);
		assert.equal(pasted.clips.length, 2);
		assert.deepEqual(pasted.sources.map(source => source.id).sort(), ['audio-source', 'video-source']);
		const video = pasted.clips.find(clip => clip.kind === 'video'); assert.ok(video);
		const audio = pasted.clips.find(clip => clip.kind === 'audio'); assert.ok(audio);
		assert.equal(video.sourceId, 'video-source'); assert.equal(audio.sourceId, 'audio-source');
		assert.notEqual(video.id, 'video-clip'); assert.notEqual(audio.id, 'audio-clip');
		assert.ok(video.avLinkId); assert.equal(video.avLinkId, audio.avLinkId);
		assert.notEqual(video.avLinkId, 'linked-av');
		assert.equal(video.sequenceStartFrame, 0);
		const sequence = pasted.sequences.find(item => item.id === video.sequenceId); assert.ok(sequence);
		assert.equal(Number(video.sequenceFrameCount) * 48_000 * Number(sequence.rate.den), 48_000 * Number(sequence.rate.num));
		assert.equal(video.sourceInFrame, 0); assert.equal(video.sourceFrameCount, 4);
		assert.equal(audio.timelineStartFrame, 0); assert.equal(audio.durationFrames, 48_000);
		const pastedVideo = pasted.sources.find(source => source.id === 'video-source'); assert.ok(pastedVideo);
		assert.deepEqual(pastedVideo.timingAsset, fixture.timing.reference);
		assert.deepEqual(pastedVideo.timingDecision, fixture.videoSource.timingDecision);
		const effects = effectsOf(video);
		assert.equal(effects.length, 1); assert.notEqual(effects[0]!.id, 'cube');
		assert.equal(effects[0]!.type, 'cube-lut-profile-v1'); assert.equal(effects[0]!.enabled, false);
		assert.deepEqual(effects[0]!.params, { lut: fixture.ref });
		await controller.actions.project.save();
		const saved = await store.loadProject(String(pasted.id)); assert.ok(saved);
		assert.deepEqual(selected.cloneProject(saved).clips, pasted.clips);
		for (const [key, expected] of [
			['video-source', fixture.original], [fixture.timing.reference.storageKey, fixture.timing.bytes],
			[fixture.ref.storageKey, fixture.cubeBytes],
		] as const) {
			const body = await store.loadMediaAsset(key); assert.ok(body);
			assert.deepEqual(new Uint8Array(await body.arrayBuffer()), expected);
		}
		assert.deepEqual((await store.readSourceChunk('audio-source', 0)).channels[0], samples);
		assert.deepEqual(selected.cloneProject(await store.loadProject(String(origin.id))).clips, origin.clips);
	} finally { await controller.dispose(); }
});

function linkedVfrCubeProject() {
	// These model-original bytes qualify storage custody, not native media decoding.
	const original = new TextEncoder().encode('unchanged VFR video original');
	const digest = createHash('sha256').update(original).digest('hex');
	const timing = createVideoTimingAssetPublication(digest, {
		timescale: 100, presentationTicks: [0n, 10n, 30n, 60n], finalFrameDurationTicks: 40n,
	});
	validateVideoTimingAssetBytes(timing.reference, timing.bytes);
	const rate = { num: 4, den: 1 };
	const videoSource = createVideoSource({ id: 'video-source', name: 'VFR', storageKey: 'video-source', mimeType: 'video/mp4',
		contentSha256: digest, frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 4,
		frameRate: rate, width: 2, height: 2, timingAsset: timing.reference,
		timingDecision: { mode: 'exact', rate, backend: 'container' } });
	const cubeText = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
	const cubeBytes = new TextEncoder().encode(cubeText), lut = parseCubeLutV1(cubeText);
	const ref = { storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256, byteLength: lut.byteLength,
		size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax };
	const options = framescaperV20Options();
	const project = createFramescaperProject(PROFILE, { ...options, id: `controller-vfr-cube-${crypto.randomUUID()}`,
		sources: (options.sources as readonly Record<string, unknown>[]).map(source => source.id === 'video-source' ? videoSource : source),
		clips: (options.clips as readonly Record<string, unknown>[]).map(clip => clip.kind === 'video'
			? { ...clip, avLinkId: 'linked-av', sequenceFrameCount: 4, sourceFrameCount: 4,
				videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: ref } }] }
			: { ...clip, avLinkId: 'linked-av' }),
		tracks: (options.tracks as readonly Record<string, unknown>[]).map(track => ({ ...track, laneGroupId: 'linked-lanes' })),
		projectBin: { clips: [] },
		sequences: [{ id: 'main-sequence', rate, trackIds: ['video-track', 'audio-track'] }],
	});
	return { project, original, timing, videoSource, cubeBytes, ref };
}
