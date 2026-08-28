/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddTrackCommand,
	createAddVideoEffectCommand,
} from '../common/editor/commands/factories.ts';
import { createStableId } from '../common/editor/stable-id.js';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { FramescaperCandidateAuthoringSurface } from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { videoFrameToSampleFrame } from '../common/editor/timeline-time.ts';
import { createVideoFreezeFallbackV1 } from '../common/editor/video-freeze-v24.ts';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';

type Data = Record<string, unknown>;
type ReadonlyData = Readonly<Record<string, unknown>>;

export interface FramescaperSelectedPreparedAuthoringFinishing {
	readonly command: unknown;
	readonly rollback?: () => Promise<void>;
}

/** Lazily prepare one selected finishing command and any owned media it roots. */
export async function prepareFramescaperSelectedAuthoringFinishing(
	surface: FramescaperCandidateAuthoringSurface,
	projectValue: unknown,
	store: AudioEditorProjectStore,
): Promise<Readonly<FramescaperSelectedPreparedAuthoringFinishing> | null> {
	assertFramescaperProjectIdentity(projectValue);
	const project = record(projectValue, 'Framescaper finishing project');
	if (surface === 'video-transition' || surface === 'video-transition-dissolve') {
		return prepared(transitionCommand(project));
	}
	if (surface === 'video-still') return prepareImportedStill(project, store);
	if (surface === 'video-title' || surface === 'video-text'
		|| surface === 'video-shape' || surface === 'video-solid') {
		return prepared(generatorCommand(project, surface));
	}
	if (surface === 'video-adjustment-layer') return prepared(adjustmentCommand(project));
	if (surface === 'video-visual-preset') return prepared(await presetCommand(project));
	if (surface === 'video-mask-matte') return prepared(maskCommand());
	if (surface === 'video-freeze') return prepareFreezeFrame(project, store);
	throw new RangeError(`Selected finishing authoring does not activate ${surface}.`);
}

function generatorCommand(project: ReadonlyData, surface: FramescaperCandidateAuthoringSurface): unknown {
	const placement = placementPlan(project);
	const sourceId = createStableId('visual-source');
	const clipId = createStableId('visual-clip');
	const generator = surface === 'video-title' ? {
		kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
	} : surface === 'video-text' ? {
		kind: 'text', text: 'Text', fontFamily: 'soundscaper-sans', fontSize: 64,
		color: '#ffffffff', horizontalAlign: 'start', verticalAlign: 'middle',
	} : surface === 'video-shape' ? {
		kind: 'shape', shape: 'rectangle', fillColor: '#ffffffff',
		strokeColor: null, strokeWidth: 0,
	} : { kind: 'solid', color: '#000000ff' };
	const source = {
		schemaVersion: 1, kind: 'generator', id: sourceId,
		name: surfaceName(surface), width: 1_920, height: 1_080,
		frameRate: placement.rate, frameCount: placement.duration, generator,
	};
	const clip = {
		schemaVersion: 1, kind: 'generator', id: clipId, sourceId,
		sequenceId: placement.sequenceId, sequenceStartFrame: placement.start,
		sequenceFrameCount: placement.duration, sourceInFrame: 0,
		sourceFrameCount: placement.duration,
	};
	return batch([
		...placement.trackCommands,
		{ type: 'video-visual-source/set', sourceId, expectedSource: null, source },
		{ type: 'video-visual-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: placement.trackId } },
	]);
}

function adjustmentCommand(project: ReadonlyData): unknown {
	const clips = records(project.clips, 'clips');
	const selectedIds = Array.isArray(recordsOrEmpty(project.selection).clipIds)
		? (recordsOrEmpty(project.selection).clipIds as unknown[]).map(String) : [];
	const tracks = records(project.tracks, 'tracks');
	const target = tracks.flatMap((track) => {
		if (track.type !== 'video' || track.locked === true || !Array.isArray(track.clipIds)) return [];
		return track.clipIds.map(String).flatMap((clipId) => {
			const clip = clips.find(({ id }) => id === clipId && id != null && (
				String(id) === clipId
			));
			return clip?.kind === 'video' ? [{ track, clip }] : [];
		});
	}).sort((left, right) => (
		Number(selectedIds.includes(String(right.clip.id))) - Number(selectedIds.includes(String(left.clip.id)))
	))[0];
	if (!target) throw new Error('Import and select a timeline video clip before adding an adjustment layer.');
	const id = createStableId('adjustment-layer');
	const effectId = createStableId('adjustment-effect');
	return batch([createAddVideoEffectCommand(String(target.clip.id), 'color-adjust', {
		id: effectId,
		params: { brightness: 0.25, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	}), {
		type: 'video-adjustment-layer/set', adjustmentLayerId: id,
		expectedAdjustmentLayer: null,
		adjustmentLayer: {
			schemaVersion: 1, kind: 'adjustment-layer', id,
			sequenceId: stableId(target.clip.sequenceId, 'adjustment sequence ID'),
			sequenceStartFrame: nonNegativeInteger(target.clip.sequenceStartFrame, 'adjustment start'),
			sequenceFrameCount: positiveInteger(target.clip.sequenceFrameCount, 'adjustment duration'),
			targetTrackIds: [stableId(target.track.id, 'adjustment track ID')],
			effectIds: [effectId],
		},
	}]);
}

function maskCommand(): unknown {
	const id = createStableId('mask-matte');
	const nodeId = createStableId('mask-node');
	return {
		type: 'video-mask-matte/set', maskMatteId: id, expectedMaskMatte: null,
		maskMatte: {
			schemaVersion: 1, id, kind: 'mask', inputs: [],
			nodes: [{ id: nodeId, kind: 'vector-shape', shape: 'rectangle',
				x: 0, y: 0, width: 1, height: 1 }],
			outputNodeId: nodeId,
		},
	};
}

async function presetCommand(project: ReadonlyData): Promise<unknown> {
	const candidates: Array<Readonly<{ modelKind: 'generator' | 'adjustment-layer' | 'mask-matte'; value: unknown }>> = [];
	for (const source of records(project.sources, 'sources')) {
		if (source.kind === 'generator') candidates.push({ modelKind: 'generator', value: source });
	}
	for (const value of records(project.videoAdjustmentLayers, 'videoAdjustmentLayers')) {
		candidates.push({ modelKind: 'adjustment-layer', value });
	}
	for (const value of records(project.videoMaskMattes, 'videoMaskMattes')) {
		candidates.push({ modelKind: 'mask-matte', value });
	}
	const authored = candidates.at(-1);
	if (!authored) throw new Error('Create a generator, adjustment layer, or mask before saving a preset.');
	const id = createStableId('visual-preset');
	return {
		type: 'video-visual-preset/set', presetId: id, expectedPreset: null,
		preset: {
			schemaVersion: 1, kind: 'video-preset', id, name: 'Visual Preset',
			modelKind: authored.modelKind,
			authoredStateSha256: fingerprintNativeMediaPlan(authored.value).sha256,
		},
	};
}

function transitionCommand(project: ReadonlyData): unknown {
	const sampleRate = positiveInteger(project.sampleRate, 'project.sampleRate');
	const clipsById = new Map(records(project.clips, 'clips').map((clip) => [String(clip.id), clip]));
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type !== 'video' || track.locked === true || !Array.isArray(track.clipIds)) continue;
		const clips = track.clipIds.map(String).map((id) => clipsById.get(id))
			.filter((clip): clip is Data => Boolean(clip?.kind === 'video' && clip.avLinkId == null))
			.sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame));
		for (let index = 1; index < clips.length; index += 1) {
			const outgoing = clips[index - 1]!;
			const incoming = clips[index]!;
			if (outgoing.sequenceId !== incoming.sequenceId) continue;
			const outgoingEnd = positiveRangeEnd(outgoing);
			const incomingStart = nonNegativeInteger(incoming.sequenceStartFrame, 'incoming start');
			if (incomingStart < outgoingEnd) continue;
			const duration = Math.max(1, Math.min(12,
				Math.floor(positiveInteger(outgoing.sequenceFrameCount, 'outgoing duration') / 2),
				Math.floor(positiveInteger(incoming.sequenceFrameCount, 'incoming duration') / 2)));
			const sequence = records(project.sequences, 'sequences')
				.find(({ id }) => id === outgoing.sequenceId);
			if (!sequence) continue;
			return {
				type: 'clip/move', clipId: String(incoming.id), trackId: String(track.id),
				timelineStartFrame: videoFrameToSampleFrame(
					outgoingEnd - duration, rate(sequence), sampleRate,
				),
				videoTransitionAllocations: [{
					trackId: String(track.id), outgoingClipId: String(outgoing.id),
					incomingClipId: String(incoming.id), transitionId: createStableId('transition'),
				}],
			};
		}
	}
	throw new Error('Select or create two adjacent unlinked video clips before adding a dissolve.');
}

async function prepareImportedStill(
	project: ReadonlyData,
	store: AudioEditorProjectStore,
): Promise<Readonly<FramescaperSelectedPreparedAuthoringFinishing> | null> {
	const file = await selectStillFile();
	if (file === null) return null;
	const dimensions = await imageDimensions(file);
	return persistStill(project, store, file, {
		name: safeSourceName(file.name), width: dimensions.width, height: dimensions.height,
		hasAlpha: file.type === 'image/png' || file.type === 'image/webp',
	});
}

async function prepareFreezeFrame(
	project: ReadonlyData,
	store: AudioEditorProjectStore,
): Promise<Readonly<FramescaperSelectedPreparedAuthoringFinishing>> {
	const clip = selectedVideoClip(project);
	const source = records(project.sources, 'sources').find(({ id }) => id === clip.sourceId);
	if (!source) throw new Error('The selected video source is unavailable for freeze-frame capture.');
	const poster = await (store as unknown as Readonly<{
		loadVideoDerivative(
			sourceId: string,
			selector: Readonly<{ timestamp: number; type: 'poster' }>,
		): Promise<Blob | null>;
	}>).loadVideoDerivative(String(source.id), { timestamp: 0, type: 'poster' });
	if (!(poster instanceof Blob)) {
		throw new Error('The selected video has no local poster available for a deterministic freeze frame.');
	}
	const preparedStill = await persistStill(project, store, poster, {
		name: `${safeSourceName(String(source.name ?? 'Video'))} Freeze`,
		width: positiveInteger(source.width, 'video source.width'),
		height: positiveInteger(source.height, 'video source.height'), hasAlpha: false,
	});
	const command = record(preparedStill.command, 'freeze-frame command batch');
	const commands = Array.isArray(command.commands) ? [...command.commands] : [command];
	const renderedSource = record(record(commands.find((item) => (
		record(item, 'freeze-frame child').type === 'video-visual-source/set'
	)), 'freeze-frame source command').source, 'freeze-frame source');
	const digest = String(renderedSource.contentSha256);
	commands.push({
		type: 'video-freeze-fallback/set', renderedSourceId: renderedSource.id,
		expectedFreezeFallback: null,
		freezeFallback: createVideoFreezeFallbackV1({
			renderedSourceId: renderedSource.id, renderedAssetSha256: digest,
			authoredStateSha256: fingerprintNativeMediaPlan({
				schemaVersion: 1, kind: 'video-freeze', renderedSourceId: renderedSource.id,
			}).sha256,
			inputIdentitiesSha256: await digestValue({ sourceId: source.id, digest: source.contentSha256 }),
			renderPlanFingerprintSha256: await digestValue({ schemaVersion: 13, clipId: clip.id }),
			nativeEffectFingerprintSha256: await digestValue({ nativeEffects: false }),
		}),
	});
	return prepared(batch(commands), preparedStill.rollback);
}

async function persistStill(
	project: ReadonlyData,
	store: AudioEditorProjectStore,
	blob: Blob,
	metadata: Readonly<{ name: string; width: number; height: number; hasAlpha: boolean }>,
): Promise<Readonly<FramescaperSelectedPreparedAuthoringFinishing>> {
	if (!/^image\/[a-z0-9][a-z0-9.+-]{0,126}$/u.test(blob.type)) {
		throw new TypeError('Framescaper still authoring requires an image media type.');
	}
	const placement = placementPlan(project);
	const sourceId = createStableId('still-source');
	const clipId = createStableId('still-clip');
	const contentSha256 = await digestMediaContent(blob);
	await store.writeMediaAsset(sourceId, blob, {
		name: metadata.name, mimeType: blob.type, width: metadata.width, height: metadata.height,
	});
	const source = {
		schemaVersion: 1, kind: 'still', id: sourceId, name: metadata.name,
		mimeType: blob.type, storageKey: sourceId, contentSha256,
		width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha,
	};
	const clip = {
		schemaVersion: 1, kind: 'still', id: clipId, sourceId,
		sequenceId: placement.sequenceId, sequenceStartFrame: placement.start,
		sequenceFrameCount: placement.duration,
	};
	return prepared(batch([
		...placement.trackCommands,
		{ type: 'video-visual-source/set', sourceId, expectedSource: null, source },
		{ type: 'video-visual-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: placement.trackId } },
	]), async () => { await store.deleteMediaAsset(sourceId); });
}

function placementPlan(project: ReadonlyData) {
	const sequenceId = typeof project.primarySequenceId === 'string'
		? project.primarySequenceId : String(records(project.sequences, 'sequences')[0]?.id ?? 'main-sequence');
	const sequence = records(project.sequences, 'sequences').find(({ id }) => id === sequenceId);
	if (!sequence) throw new Error('Framescaper visual authoring requires a primary sequence.');
	const tracks = records(project.tracks, 'tracks');
	const selectedTrackIds = recordsOrEmpty(project.selection).trackIds;
	const selectedId = Array.isArray(selectedTrackIds) ? selectedTrackIds.find((id) => (
		tracks.some((track) => track.id === id && track.type === 'video' && track.locked !== true)
	)) : undefined;
	const existing = tracks.find((track) => track.id === selectedId)
		?? tracks.find((track) => track.type === 'video' && track.locked !== true);
	const trackId = existing ? String(existing.id) : createStableId('video-track');
	const trackCommands = existing ? [] : [{
		...createAddTrackCommand({ type: 'video', id: trackId, name: 'Visuals', laneGroupId: null }),
		index: tracks.length,
	}];
	const clipIds = existing && Array.isArray(existing.clipIds) ? new Set(existing.clipIds.map(String)) : new Set<string>();
	let start = 0;
	for (const clip of records(project.clips, 'clips')) {
		if (!clipIds.has(String(clip.id)) || clip.sequenceId !== sequenceId) continue;
		start = Math.max(start, positiveRangeEnd(clip));
	}
	const frameRate = rate(sequence);
	const duration = Math.max(1, Math.round(frameRate.num * 5 / frameRate.den));
	return Object.freeze({ sequenceId, trackId, trackCommands, start, duration, rate: frameRate });
}

function selectedVideoClip(project: ReadonlyData): Data {
	const clips = records(project.clips, 'clips');
	const selected = recordsOrEmpty(project.selection).clipIds;
	const selectedIds = Array.isArray(selected) ? selected.map(String) : [];
	const clip = clips.find((candidate) => selectedIds.includes(String(candidate.id))
		&& candidate.kind === 'video') ?? clips.find(({ kind }) => kind === 'video');
	if (!clip) throw new Error('Select a timeline video clip before freezing a frame.');
	return clip;
}

function batch(commands: readonly unknown[]): unknown {
	return commands.length === 1 ? commands[0] : { type: 'batch', commands };
}

function prepared(
	command: unknown,
	rollback?: () => Promise<void>,
): Readonly<FramescaperSelectedPreparedAuthoringFinishing> {
	return Object.freeze({ command, ...(rollback ? { rollback } : {}) });
}

async function digestValue(value: unknown): Promise<string> {
	return digestMediaContent(new Blob([JSON.stringify(value)], { type: 'application/json' }));
}

function positiveRangeEnd(clip: ReadonlyData): number {
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'clip sequence start');
	const duration = positiveInteger(clip.sequenceFrameCount, 'clip sequence duration');
	const end = start + duration;
	if (!Number.isSafeInteger(end)) throw new RangeError('The visual clip range exceeds safe integers.');
	return end;
}

function rate(sequence: ReadonlyData): Readonly<{ num: number; den: number }> {
	const value = record(sequence.rate, 'sequence rate');
	return Object.freeze({
		num: positiveInteger(value.num, 'sequence rate numerator'),
		den: positiveInteger(value.den, 'sequence rate denominator'),
	});
}

async function selectStillFile(): Promise<File | null> {
	if (!globalThis.document?.createElement) throw new Error('Still selection requires the browser editor.');
	return new Promise((resolve) => {
		const input = globalThis.document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.hidden = true;
		const finish = (file: File | null): void => { input.remove(); resolve(file); };
		input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => finish(null), { once: true });
		globalThis.document.body.append(input);
		input.click();
	});
}

async function imageDimensions(file: File): Promise<Readonly<{ width: number; height: number }>> {
	if (typeof globalThis.createImageBitmap !== 'function') {
		throw new Error('This browser cannot inspect still-image dimensions.');
	}
	const bitmap = await globalThis.createImageBitmap(file);
	try {
		return Object.freeze({
			width: positiveInteger(bitmap.width, 'still width'),
			height: positiveInteger(bitmap.height, 'still height'),
		});
	} finally { bitmap.close(); }
}

function surfaceName(surface: FramescaperCandidateAuthoringSurface): string {
	if (surface === 'video-title') return 'Title';
	if (surface === 'video-text') return 'Text';
	if (surface === 'video-shape') return 'Shape';
	return 'Solid';
}

function safeSourceName(value: string): string {
	const normalized = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\r\n]/gu, ' ').trim();
	return normalized.slice(0, 512) || 'Still';
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function recordsOrEmpty(value: unknown): Data {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Data;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
