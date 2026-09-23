/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav as encodeProjectWav } from '../../../wav.js';
import { createDefaultMixerGraphV21 } from '../../../mixer-graph-v21.ts';
import { createAudioTrack } from '../../../project-media-factory.ts';
import {
	hasProductionMixerProjectAuthority,
	isProductionMixerProjectSchema,
} from '../../../project-schema-version.ts';
import type {
	FreesoundUploadClipMetadata,
	FreesoundUploadSourceMetadata,
} from '../../../freesound-upload-metadata.ts';

const MAXIMUM_UPLOAD_BYTES = 100_000_000;
const WAV_HEADER_ALLOWANCE_BYTES = 4_096;

interface MaterializerClip extends FreesoundUploadClipMetadata, Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sourceId: string;
	readonly title?: string;
	readonly timelineStartFrame?: number;
}

type RenderableMaterializerClip = MaterializerClip & Readonly<{
	timelineStartFrame: number;
	durationFrames: number;
}>;

interface MaterializerTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type?: string;
	readonly channelCount?: number;
	readonly clipIds?: readonly string[];
}

interface MaterializerSource extends FreesoundUploadSourceMetadata, Readonly<Record<string, unknown>> {
	readonly id: string;
}

export interface FreesoundClipMaterializerProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly sampleRate: number;
	readonly masterChannels?: number;
	readonly clips: readonly MaterializerClip[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly MaterializerClip[] }>;
	readonly tracks: readonly MaterializerTrack[];
	readonly sources: readonly MaterializerSource[];
	readonly master?: Readonly<Record<string, unknown>>;
	readonly mixer?: Readonly<{
		readonly groups?: readonly object[];
		readonly sends?: readonly object[];
		readonly routes?: Readonly<Record<string, object>>;
		readonly outputs?: readonly Readonly<{ readonly role?: unknown; readonly channelCount?: unknown }>[];
	}>;
}

export interface FreesoundRenderedClipAudio {
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

export interface FreesoundMaterializedClipUpload {
	readonly file: File;
	readonly source: MaterializerSource;
	readonly clip: MaterializerClip;
	readonly clipTitle: string;
}

export interface FreesoundClipUploadMaterializerRuntime<
	Project extends object = FreesoundClipMaterializerProject,
> {
	readonly getProject: () => Project | null;
	readonly renderClip: (
		project: Project,
		range: Readonly<{ readonly startFrame: number; readonly endFrame: number }>,
		signal?: AbortSignal,
	) => Promise<FreesoundRenderedClipAudio>;
	readonly encodeWav?: (
		channels: readonly Float32Array[],
		options: Readonly<{
			readonly sampleRate: number;
			readonly bitDepth: 24;
			readonly float: false;
			readonly dither: 'triangular';
		}>,
	) => Uint8Array;
	readonly maximumBytes?: number;
}

/** Build the queue seam that renders one immutable clip snapshot to uploadable PCM WAV. */
export function createFreesoundClipUploadMaterializer<Project extends object>(
	runtime: FreesoundClipUploadMaterializerRuntime<Project>,
) {
	const maximumBytes = positiveInteger(runtime.maximumBytes ?? MAXIMUM_UPLOAD_BYTES, 'maximum upload bytes');
	const encodeWav = runtime.encodeWav ?? encodeProjectWav;

	async function materialize(request: Readonly<{
		readonly projectId: string;
		readonly clipId: string;
		readonly signal?: AbortSignal;
	}>): Promise<FreesoundMaterializedClipUpload> {
		request.signal?.throwIfAborted();
		const current = runtime.getProject();
		if (!current) throw staleProjectError();
		const project = materializerProject(current);
		if (project.id !== request.projectId) throw staleProjectError();
		const clip = findClip(project, request.clipId);
		const source = project.sources.find(({ id }) => id === clip.sourceId);
		if (!source) throw new ReferenceError(`The clip source ${clip.sourceId} is unavailable.`);
		const projection = createIsolatedFreesoundClipRenderProject(project, clip.id);
		const expectedChannels = projectedOutputChannelCount(projection, source);
		assertWavSize(clip.durationFrames, expectedChannels, maximumBytes);
		const projectedClip = findTimelineClip(projection, clip.id);
		const range = Object.freeze({
			startFrame: projectedClip.timelineStartFrame,
			endFrame: projectedClip.timelineStartFrame + projectedClip.durationFrames,
		});
		const rendered = await runtime.renderClip(projection as unknown as Project, range, request.signal);
		request.signal?.throwIfAborted();
		if (runtime.getProject() !== current) throw staleProjectError();
		const channels = renderedChannels(rendered, clip.durationFrames);
		assertWavSize(rendered.length, channels.length, maximumBytes);
		const encoded = encodeWav(channels, {
			sampleRate: positiveInteger(rendered.sampleRate, 'rendered sample rate'),
			bitDepth: 24,
			float: false,
			dither: 'triangular',
		});
		if (!(encoded instanceof Uint8Array) || encoded.byteLength > maximumBytes) {
			throw new RangeError('The rendered clip exceeds the 100 MB Freesound upload limit.');
		}
		request.signal?.throwIfAborted();
		if (runtime.getProject() !== current) throw staleProjectError();
		const clipTitle = cleanTitle(clip.title) || cleanTitle(source.name) || 'Soundscaper clip';
		const owned = Uint8Array.from(encoded);
		return Object.freeze({
			file: new File([owned.buffer], `${fileStem(clipTitle)}.wav`, { type: 'audio/wav', lastModified: 0 }),
			source,
			clip,
			clipTitle,
		});
	}

	return Object.freeze({ materialize });
}

/** Remove neighbouring clips and every track, bus, send, and master contribution from one clip render. */
export function createIsolatedFreesoundClipRenderProject<Project extends FreesoundClipMaterializerProject>(
	project: Project,
	clipId: string,
): Project {
	const located = locateClip(project, clipId);
	const clip = located.clip;
	const source = project.sources.find(({ id }) => id === clip.sourceId);
	if (!source) throw new ReferenceError(`The clip source ${clip.sourceId} is unavailable.`);
	const owner = project.tracks.find(({ clipIds }) => clipIds?.includes(clip.id))
		?? project.tracks.find(({ type }) => type === 'audio')
		?? createAudioTrack({
			id: `freesound-upload-${clip.id}`,
			name: 'Freesound upload',
			clipIds: [],
			channelCount: boundedChannelCount(source.channelCount ?? 2),
		}, project.sampleRate);
	const productionMixer = isProductionMixerProject(project);
	const clone = structuredClone(project) as unknown as MutableProject;
	if (!clone.tracks.some(({ id }) => id === owner.id)) {
		clone.tracks.push(structuredClone(owner) as Record<string, unknown> & { id: string });
	}
	clone.clips = located.store === 'timeline'
		? clone.clips.filter(({ id }) => id === clip.id)
		: [{
			...structuredClone(clip),
			timelineStartFrame: 0,
			groupId: null,
			avLinkId: null,
			binItemId: null,
		}];
	if (clone.projectBin?.clips) {
		clone.projectBin.clips = clone.projectBin.clips.filter(({ id }) => id !== clip.id);
	}
	clone.tracks = productionMixer
		? clone.tracks.filter(({ id }) => id === owner.id).map((track) => cleanTrack(track, [clip.id], false))
		: clone.tracks.map((track) => track.id === owner.id
			? cleanTrack(track, [clip.id], false)
			: cleanTrack(track, [], true));
	clone.master = cleanMixNode(clone.master ?? {});
	if (productionMixer) {
		const masterChannels = boundedChannelCount(project.masterChannels ?? source.channelCount ?? 2);
		const targetChannels = boundedChannelCount(owner.channelCount ?? source.channelCount ?? masterChannels);
		clone.mixer = createDefaultMixerGraphV21([{
			id: owner.id,
			channelCount: targetChannels,
		}], masterChannels) as unknown as MutableProject['mixer'];
		clone.automationLanes = [];
	} else if (clone.mixer) {
		clone.mixer = {
			...clone.mixer,
			groups: (clone.mixer.groups ?? []).map(cleanMixNode),
			sends: (clone.mixer.sends ?? []).map(cleanMixNode),
			routes: Object.fromEntries(Object.keys(clone.mixer.routes ?? {}).map((trackId) => [
				trackId, { groupId: null, sends: {} },
			])),
		};
	}
	return clone as unknown as Project;
}

interface MutableProject extends Record<string, unknown> {
	clips: Array<Record<string, unknown> & { id: string }>;
	tracks: Array<Record<string, unknown> & { id: string }>;
	projectBin?: { clips?: Array<Record<string, unknown> & { id: string }> };
	master?: Record<string, unknown>;
	automationLanes?: unknown[];
	mixer?: {
		groups?: object[];
		sends?: object[];
		routes?: Record<string, object>;
		outputs?: Array<{ role?: unknown; channelCount?: unknown }>;
	};
}

function isProductionMixerProject(project: object): boolean {
	return hasProductionMixerProjectAuthority(project) || isProductionMixerProjectSchema(project);
}

function projectedOutputChannelCount(
	project: FreesoundClipMaterializerProject,
	source: MaterializerSource,
): number {
	if (!isProductionMixerProject(project)) {
		return boundedChannelCount(project.masterChannels ?? source.channelCount ?? 2);
	}
	const outputs = project.mixer?.outputs;
	if (!Array.isArray(outputs)) throw new TypeError('The isolated production mixer has no outputs.');
	const main = outputs.find((candidate) => isRecord(candidate) && candidate.role === 'main');
	if (!isRecord(main)) throw new TypeError('The isolated production mixer has no main output.');
	return boundedChannelCount(main.channelCount);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanTrack(
	track: Record<string, unknown> & { id: string },
	clipIds: readonly string[],
	mute: boolean,
): Record<string, unknown> & { id: string } {
	return {
		...track,
		clipIds: [...clipIds],
		gain: 1,
		pan: 0,
		mute,
		solo: false,
		effectsActive: false,
		effects: [],
		envelope: [],
	};
}

function cleanMixNode(value: object): Record<string, unknown> {
	return {
		...value,
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effectsActive: false,
		effects: [],
	};
}

function findClip(project: FreesoundClipMaterializerProject, value: string): RenderableMaterializerClip {
	return locateClip(project, value).clip;
}

function locateClip(
	project: FreesoundClipMaterializerProject,
	value: string,
): Readonly<{ clip: RenderableMaterializerClip; store: 'timeline' | 'project-bin' }> {
	if (typeof value !== 'string' || !value) throw new TypeError('A clip ID is required.');
	const timelineClip = project.clips.find(({ id }) => id === value);
	const clip = timelineClip ?? project.projectBin?.clips?.find(({ id }) => id === value);
	if (!clip) throw new ReferenceError(`Unknown audio clip: ${value}.`);
	if (clip.kind !== undefined && clip.kind !== 'audio') throw new TypeError('Only audio clips can be uploaded.');
	positiveInteger(clip.durationFrames, 'clip duration');
	if (typeof clip.timelineStartFrame !== 'number'
		|| !Number.isSafeInteger(clip.timelineStartFrame) || clip.timelineStartFrame < 0) {
		throw new RangeError('The clip timeline start is invalid.');
	}
	return Object.freeze({
		clip: clip as RenderableMaterializerClip,
		store: timelineClip ? 'timeline' : 'project-bin',
	});
}

function findTimelineClip(
	project: FreesoundClipMaterializerProject,
	value: string,
): RenderableMaterializerClip {
	const clip = project.clips.find(({ id }) => id === value);
	if (!clip) throw new ReferenceError(`The isolated audio clip ${value} is unavailable.`);
	return clip as RenderableMaterializerClip;
}

function materializerProject(value: object): FreesoundClipMaterializerProject {
	if (!isRecord(value)) throw new TypeError('A Freesound clip upload requires a project object.');
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('The upload project ID is invalid.');
	positiveInteger(value.sampleRate, 'project sample rate');
	if (!Array.isArray(value.clips) || !Array.isArray(value.tracks) || !Array.isArray(value.sources)) {
		throw new TypeError('The upload project media collections are invalid.');
	}
	return value as unknown as FreesoundClipMaterializerProject;
}

function renderedChannels(rendered: FreesoundRenderedClipAudio, expectedFrames: number): readonly Float32Array[] {
	const channelCount = boundedChannelCount(rendered.numberOfChannels);
	if (positiveInteger(rendered.length, 'rendered frame count') !== expectedFrames) {
		throw new Error('The isolated clip render returned an unexpected frame count.');
	}
	const channels = Array.from({ length: channelCount }, (_, channel) => rendered.getChannelData(channel));
	if (channels.some((samples) => !(samples instanceof Float32Array) || samples.length !== rendered.length)) {
		throw new TypeError('The isolated clip render returned malformed PCM.');
	}
	return channels;
}

function assertWavSize(frameCount: number, channelCount: number, maximumBytes: number): void {
	const sampleBytes = frameCount * channelCount * 3;
	if (!Number.isSafeInteger(sampleBytes) || sampleBytes + WAV_HEADER_ALLOWANCE_BYTES > maximumBytes) {
		throw new RangeError('The rendered clip exceeds the 100 MB Freesound upload limit.');
	}
}

function boundedChannelCount(value: unknown): number {
	const channels = positiveInteger(value, 'rendered channel count');
	if (channels > 64) throw new RangeError('The isolated clip render has too many channels.');
	return channels;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function cleanTitle(value: unknown): string {
	return typeof value === 'string'
		? replaceControlCharacters(value, ' ').replace(/\s+/gu, ' ').trim().slice(0, 512)
		: '';
}

function fileStem(value: string): string {
	const safe = replaceControlCharacters(value, '-').replace(/[\\/:*?"<>|]+/gu, '-')
		.replace(/^\.+/u, '').trim().slice(0, 220);
	return safe || 'soundscaper-clip';
}

function replaceControlCharacters(value: string, replacement: string): string {
	return Array.from(value, (character) => {
		const code = character.codePointAt(0)!;
		return code < 32 || code === 127 ? replacement : character;
	}).join('');
}

function staleProjectError(): DOMException {
	return new DOMException('The project changed while preparing the Freesound upload.', 'AbortError');
}
