/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	classifyAudioTrackFreezeFreshnessV1,
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	sameAudioTrackFreezeV1,
	type AudioTrackFreezeV1,
} from '../common/editor/audio-track-freeze-v21.ts';
import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import {
	createTransientAnalysisPcmAccess,
	type TransientAnalysisPcmSource,
	type TransientAnalysisPcmStore,
} from '../common/editor/controller/transient-analysis-pcm-access.ts';
import { normalizeMixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
} from '../common/editor/track-folder-media-runtime.ts';
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts';
import { soundscaperAudioTrackFreezeRequirementId } from './editor-project-feature-requirements.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface VerifiedSoundscaperAudioTrackFreeze {
	readonly project: object;
	readonly trackId: string;
	readonly freeze: AudioTrackFreezeV1;
	readonly derivedSource: DataRecord;
	readonly sourceContentIdentities: readonly Readonly<{
		readonly sourceId: string;
		readonly contentSha256: string;
	}>[];
}

export type SoundscaperAudioTrackFreezeStatus = 'none' | 'fresh' | 'stale' | 'unknown';

export interface SoundscaperAudioTrackFreezePlaybackService extends PlaybackProjectService {
	readonly hashSourceContent: (
		projectId: string,
		source: DataRecord,
		signal?: AbortSignal,
	) => Promise<string>;
	readonly admitVerifiedFreeze: (request: VerifiedSoundscaperAudioTrackFreeze) => () => void;
	readonly getFreezeStatus: (
		project: object,
		trackId: string,
	) => SoundscaperAudioTrackFreezeStatus;
	readonly dispose: () => void;
}

interface FreezeAdmission {
	readonly projectId: string;
	readonly trackId: string;
	readonly freeze: AudioTrackFreezeV1;
	readonly derivedSourceContentSha256: string;
	readonly sourceContentIdentities: readonly Readonly<{
		readonly sourceId: string;
		readonly contentSha256: string;
	}>[];
}

/** Add verified, fresh native freeze substitution around the common compatibility projector. */
export function createSoundscaperAudioTrackFreezePlaybackService(
	base: PlaybackProjectService,
	store: TransientAnalysisPcmStore,
): Readonly<SoundscaperAudioTrackFreezePlaybackService> {
	if (!base || typeof base.projectForPlayback !== 'function'
		|| typeof base.projectForAudioRenderedFallbackDelivery !== 'function'
		|| typeof base.projectForVideoRenderedFallbackDelivery !== 'function') {
		throw new TypeError('A complete Soundscaper playback service is required for freeze projection.');
	}
	const pcm = createTransientAnalysisPcmAccess({ store });
	const admissions = new Map<string, FreezeAdmission>();
	return Object.freeze({
		prepareProjectForActivation,
		projectForActivationAdmission: projectForPlayback,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery,
		projectForVideoRenderedFallbackDelivery,
		hashSourceContent,
		admitVerifiedFreeze,
		getFreezeStatus,
		dispose,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		options: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		await base.prepareProjectForActivation?.(project, options);
		const candidate = dataRecord(project, 'Soundscaper freeze activation project');
		if (!isCurrentProjectSchemaIdentity(candidate, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) return;
		const projectId = stableId(candidate.id, 'Soundscaper freeze activation project');
		const prepared: VerifiedSoundscaperAudioTrackFreeze[] = [];
		for (const track of dataArray(candidate.tracks, 'project.tracks')) {
			if (!Object.hasOwn(track, 'audioFreeze')) continue;
			try {
				const trackId = stableId(track.id, 'frozen audio track');
				const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
				const identities = await sourceIdentities(projectId, candidate, track, options.signal);
				computeAudioTrackFreezeDigestsV1({
					sampleRate: candidate.sampleRate as number,
					renderStartFrame: freeze.renderStartFrame,
					renderFrameCount: freeze.renderFrameCount,
					track,
					clips: dataArray(candidate.clips, 'project.clips'),
					sourceContentIdentities: identities,
					automationLanes: dataArray(candidate.automationLanes, 'project.automationLanes'),
					tempoMap: candidate.tempoMap ?? null,
				});
				const derivedSource = exactRecordById(
					dataArray(candidate.sources, 'project.sources'), freeze.derivedSourceId, 'derived source',
				);
				await hashSourceContent(projectId, derivedSource, options.signal);
				prepared.push({ project, trackId, freeze, derivedSource, sourceContentIdentities: identities });
			} catch (error) {
				if (options.signal?.aborted) throw options.signal.reason ?? error;
			}
		}
		for (const admission of prepared) admitVerifiedFreeze(admission);
	}

	function projectForPlayback<Project extends object>(project: Project) {
		return addFreezeProjection(base.projectForPlayback(project), project);
	}

	function projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
		return addFreezeProjection(base.projectForAudioRenderedFallbackDelivery(project), project);
	}

	function projectForVideoRenderedFallbackDelivery<Project extends object>(project: Project) {
		return addFreezeProjection(base.projectForVideoRenderedFallbackDelivery(project), project);
	}

	function addFreezeProjection<Result extends Readonly<{
		readonly project: object;
		readonly requiredAudioSourceIds: readonly string[];
	}>>(result: Result, canonicalProject: object): Result {
		const selected = selectFreshAdmissions(canonicalProject);
		if (!selected.length) return result;
		const projection = projectVerifiedFreezes(result.project, selected);
		return Object.freeze({
			...result,
			project: projection.project,
			requiredAudioSourceIds: Object.freeze([
				...new Set([...result.requiredAudioSourceIds, ...projection.sourceIds]),
			]),
		}) as Result;
	}

	async function hashSourceContent(
		projectId: string,
		sourceValue: DataRecord,
		signal?: AbortSignal,
	): Promise<string> {
		const source = dataRecord(sourceValue, 'audio freeze PCM source');
		const actual = await pcm.resolveSourceSha256(
			stableId(projectId, 'audio freeze project'),
			{ ...source, contentSha256: undefined } as TransientAnalysisPcmSource,
			signal ?? new AbortController().signal,
		);
		if (Object.hasOwn(source, 'contentSha256') && source.contentSha256 !== undefined
			&& source.contentSha256 !== actual) {
			throw new Error(`Stored PCM for ${String(source.id)} does not match its project digest.`);
		}
		return actual;
	}

	function admitVerifiedFreeze(request: VerifiedSoundscaperAudioTrackFreeze): () => void {
		const project = dataRecord(request.project, 'verified freeze project');
		const projectId = stableId(project.id, 'verified freeze project');
		const trackId = stableId(request.trackId, 'verified frozen audio track');
		const freeze = normalizeAudioTrackFreezeV1(request.freeze);
		const derivedSource = dataRecord(request.derivedSource, 'verified freeze derived source');
		if (derivedSource.id !== freeze.derivedSourceId) {
			throw new RangeError('Verified freeze source identity does not match its freeze record.');
		}
		const derivedSourceContentSha256 = digest(
			derivedSource.contentSha256, 'verified freeze derived source',
		);
		const identities = snapshotIdentities(request.sourceContentIdentities);
		const key = admissionKey(projectId, trackId, freeze.derivedSourceId);
		const admission = Object.freeze({
			projectId, trackId, freeze, derivedSourceContentSha256,
			sourceContentIdentities: identities,
		});
		admissions.set(key, admission);
		return () => { if (admissions.get(key) === admission) admissions.delete(key); };
	}

	function selectFreshAdmissions(projectValue: object): readonly FreezeAdmission[] {
		const project = dataRecord(projectValue, 'freeze playback project');
		if (!isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) return Object.freeze([]);
		const projectId = stableId(project.id, 'freeze playback project');
		const clips = dataArray(project.clips, 'project.clips');
		const sources = dataArray(project.sources, 'project.sources');
		const lanes = dataArray(project.automationLanes, 'project.automationLanes');
		const selected: FreezeAdmission[] = [];
		for (const track of dataArray(project.tracks, 'project.tracks')) {
			if (!Object.hasOwn(track, 'audioFreeze')) continue;
			const trackId = stableId(track.id, 'freeze playback track');
			const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
			const admission = admissions.get(admissionKey(projectId, trackId, freeze.derivedSourceId));
			if (!admission || !sameAudioTrackFreezeV1(freeze, admission.freeze)) continue;
			if (verifiedAdmissionStatus(project, track, clips, sources, lanes, freeze, admission) === 'fresh') {
				selected.push(admission);
			}
		}
		return Object.freeze(selected);
	}

	function getFreezeStatus(
		projectValue: object,
		trackIdValue: string,
	): SoundscaperAudioTrackFreezeStatus {
		try {
			const project = dataRecord(projectValue, 'freeze status project');
			if (!isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)) return 'unknown';
			const trackId = stableId(trackIdValue, 'freeze status track');
			const matches = dataArray(project.tracks, 'project.tracks').filter(({ id }) => id === trackId);
			if (matches.length !== 1 || matches[0]!.type !== 'audio') return 'unknown';
			const track = matches[0]!;
			if (!Object.hasOwn(track, 'audioFreeze')) return 'none';
			const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
			const projectId = stableId(project.id, 'freeze status project');
			const admission = admissions.get(admissionKey(projectId, trackId, freeze.derivedSourceId));
			if (!admission || !sameAudioTrackFreezeV1(freeze, admission.freeze)) return 'unknown';
			return verifiedAdmissionStatus(
				project,
				track,
				dataArray(project.clips, 'project.clips'),
				dataArray(project.sources, 'project.sources'),
				dataArray(project.automationLanes, 'project.automationLanes'),
				freeze,
				admission,
			);
		} catch {
			return 'unknown';
		}
	}

	async function sourceIdentities(
		projectId: string,
		project: DataRecord,
		track: DataRecord,
		signal?: AbortSignal,
	): Promise<readonly Readonly<{ sourceId: string; contentSha256: string }>[]> {
		const clips = dataArray(project.clips, 'project.clips');
		const sources = dataArray(project.sources, 'project.sources');
		const seen = new Set<string>();
		const identities: Array<Readonly<{ sourceId: string; contentSha256: string }>> = [];
		for (const clipIdValue of arrayValue(track.clipIds, 'frozen track.clipIds')) {
			const clipId = stableId(clipIdValue, 'frozen track clip');
			const clip = exactRecordById(clips, clipId, 'frozen track clip');
			const sourceId = stableId(clip.sourceId, `frozen track clip ${clipId} source`);
			if (seen.has(sourceId)) continue;
			seen.add(sourceId);
			const source = exactRecordById(sources, sourceId, 'frozen track source');
			identities.push(Object.freeze({
				sourceId,
				contentSha256: await hashSourceContent(projectId, source, signal),
			}));
		}
		return Object.freeze(identities);
	}

	function dispose(): void {
		pcm.dispose();
		admissions.clear();
	}
}

function projectVerifiedFreezes(
	projectValue: object,
	admissions: readonly FreezeAdmission[],
): Readonly<{ readonly project: object; readonly sourceIds: readonly string[] }> {
	const project = dataRecord(projectValue, 'freeze playback projection');
	const byTrack = new Map(admissions.map((entry) => [entry.trackId, entry]));
	const tracks = dataArray(project.tracks, 'project.tracks');
	const ownedClipIds = new Set<string>();
	const renderedClips: DataRecord[] = [];
	const projectedTracks = tracks.map((track) => {
		const trackId = typeof track.id === 'string' ? track.id : '';
		const admission = byTrack.get(trackId);
		if (!admission) return track;
		for (const value of arrayValue(track.clipIds, `frozen track ${trackId}.clipIds`)) {
			ownedClipIds.add(stableId(value, `frozen track ${trackId} clip`));
		}
		const clipId = freezePlaybackClipId(trackId);
		assertClipIdAvailable(project, clipId);
		renderedClips.push(renderedFreezeClip(clipId, admission.freeze));
		const projected: Record<string, unknown> = {
			...track,
			clipIds: Object.freeze([clipId]),
			effectsActive: false,
			effects: Object.freeze([]),
		};
		delete projected.audioFreeze;
		return Object.freeze(projected);
	});
	const clips = Object.freeze([
		...dataArray(project.clips, 'project.clips').filter((clip) => !ownedClipIds.has(String(clip.id))),
		...renderedClips,
	]);
	const trackIds = new Set(admissions.map(({ trackId }) => trackId));
	const lanes = Object.freeze(dataArray(project.automationLanes, 'project.automationLanes').filter((lane) => {
		const address = isRecord(lane.address) ? lane.address : null;
		const strip = address && isRecord(address.strip) ? address.strip : null;
		return address?.kind !== 'effect' || strip?.kind !== 'track' || !trackIds.has(String(strip.id));
	}));
	const graph = normalizeMixerGraphV21(project.mixer);
	const mixer = normalizeMixerGraphV21({
		...graph,
		edges: graph.edges.filter((edge) => edge.destination.kind !== 'effect-sidechain'
			|| edge.destination.strip.kind !== 'track'
			|| !trackIds.has(edge.destination.strip.id)),
	});
	// The input is the folder-media projection the playback service built, and its
	// trust is private: a spread carries the enumerable marker across and leaves
	// the trust behind, which makes the rebuilt document one the engine refuses on
	// load. Inheriting it is what says this derivation is the same projection with
	// the frozen renders swapped in.
	const rebuilt = Object.freeze({
		...project, tracks: Object.freeze(projectedTracks), clips, automationLanes: lanes, mixer,
	});
	return Object.freeze({
		project: inheritTrackFolderMediaStateProjectionV12(project, rebuilt),
		sourceIds: Object.freeze(admissions.map(({ freeze }) => freeze.derivedSourceId)),
	});
}

function renderedFreezeClip(id: string, freeze: AudioTrackFreezeV1): DataRecord {
	return Object.freeze({
		id, kind: 'audio', sourceId: freeze.derivedSourceId, title: 'Frozen track render',
		timelineStartFrame: freeze.renderStartFrame, sourceStartFrame: 0,
		sourceDurationFrames: freeze.renderFrameCount, durationFrames: freeze.renderFrameCount,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		reversed: false, envelope: Object.freeze([]), groupId: null, color: 'auto',
		pitchCents: 0, speedRatio: 1, preserveFormants: false, stretchToTempo: false,
		renderCacheRevision: 0, avLinkId: null, binItemId: null, opaqueExtensions: Object.freeze({}),
		anchor: 'sample', musicalStartBeat: null, musicalExtent: 'fixedSamples',
		musicalDurationBeats: null, warpMap: null,
	});
}

function freezePlaybackClipId(trackId: string): string {
	return `${soundscaperAudioTrackFreezeRequirementId(trackId)}clip`;
}

function assertClipIdAvailable(project: DataRecord, clipId: string): void {
	const bin = isRecord(project.projectBin) ? project.projectBin : {};
	for (const values of [dataArray(project.clips, 'project.clips'), dataArray(bin.clips ?? [], 'project.projectBin.clips')]) {
		if (values.some((clip) => clip.id === clipId)) {
			throw new RangeError(`Frozen playback clip ID ${clipId} collides with canonical project state.`);
		}
	}
}

function identitiesMatchDescriptors(
	sources: readonly DataRecord[],
	identities: readonly Readonly<{ readonly sourceId: string; readonly contentSha256: string }>[],
): boolean {
	return identities.every((identity) => {
		const matches = sources.filter(({ id }) => id === identity.sourceId);
		if (matches.length !== 1) return false;
		const declared = matches[0]!.contentSha256;
		return declared === undefined || declared === identity.contentSha256;
	});
}

function verifiedAdmissionStatus(
	project: DataRecord,
	track: DataRecord,
	clips: readonly DataRecord[],
	sources: readonly DataRecord[],
	lanes: readonly DataRecord[],
	freeze: AudioTrackFreezeV1,
	admission: FreezeAdmission,
): 'fresh' | 'stale' {
	try {
		const source = exactRecordById(sources, freeze.derivedSourceId, 'freeze playback source');
		if (source.contentSha256 !== admission.derivedSourceContentSha256
			|| !identitiesMatchDescriptors(sources, admission.sourceContentIdentities)) return 'stale';
		const digests = computeAudioTrackFreezeDigestsV1({
			sampleRate: project.sampleRate as number,
			renderStartFrame: freeze.renderStartFrame,
			renderFrameCount: freeze.renderFrameCount,
			track,
			clips,
			sourceContentIdentities: admission.sourceContentIdentities,
			automationLanes: lanes,
			tempoMap: project.tempoMap ?? null,
		});
		return classifyAudioTrackFreezeFreshnessV1(freeze, digests).status === 'fresh'
			? 'fresh' : 'stale';
	} catch {
		return 'stale';
	}
}

function snapshotIdentities(value: readonly Readonly<{
	readonly sourceId: string;
	readonly contentSha256: string;
}>[]): readonly Readonly<{ readonly sourceId: string; readonly contentSha256: string }>[] {
	if (!Array.isArray(value) || value.length === 0) throw new RangeError('A verified freeze needs source identities.');
	const result = value.map((identity) => Object.freeze({
		sourceId: stableId(identity.sourceId, 'verified freeze source'),
		contentSha256: digest(identity.contentSha256, 'verified freeze source'),
	}));
	if (new Set(result.map(({ sourceId }) => sourceId)).size !== result.length) {
		throw new RangeError('Verified freeze source identities must be unique.');
	}
	return Object.freeze(result);
}

function admissionKey(projectId: string, trackId: string, sourceId: string): string {
	return `${projectId}\u0000${trackId}\u0000${sourceId}`;
}

function exactRecordById(values: readonly DataRecord[], id: string, name: string): DataRecord {
	const matches = values.filter((candidate) => candidate.id === id);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return matches[0]!;
}

function dataArray(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${name} content digest must be lowercase SHA-256.`);
	}
	return value;
}
