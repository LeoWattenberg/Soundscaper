/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	classifyAudioTrackFreezeFreshnessV1,
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
} from '../common/editor/audio-track-freeze-v21.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import {
	normalizeProjectFeatureRequirements,
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureRequirement,
	type ProjectFeatureRequirementsManifest,
} from '../common/editor/project-feature-requirements.ts';

export const SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX =
	'soundscaper.audio-track-freeze.' as const;
export const SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_DISPLAY_NAME =
	'Frozen audio track' as const;

type DataRecord = Readonly<Record<string, unknown>>;

const SHA256 = /^[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

/** Derive a bounded manifest identity without narrowing the inherited track-ID domain. */
export function soundscaperAudioTrackFreezeRequirementIdV21(trackIdValue: unknown): string {
	const trackId = stableId(trackIdValue, 'audio track');
	return `${SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX}${bytesToHex(
		sha256(TEXT_ENCODER.encode(trackId)),
	)}`;
}

/** Reconcile every exact V21 track relationship to one product-owned rendered fallback. */
export function reconcileSoundscaperProjectFeatureRequirementsV21(
	projectValue: DataRecord,
	manifestValue: ProjectFeatureRequirementsManifest,
	label = 'Soundscaper V21 project',
): ProjectFeatureRequirementsManifest {
	const project = dataRecord(projectValue, label);
	const manifest = dataRecord(manifestValue, 'project.featureRequirements');
	if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.requirements)) {
		throw new TypeError('Soundscaper V21 feature requirements must be an exact schema-2 manifest.');
	}
	const expected = expectedFreezeRequirements(project);
	const expectedById = new Map(expected.map((requirement) => [requirement.id, requirement]));
	const retained: ProjectFeatureRequirement[] = [];
	for (const [index, candidate] of manifest.requirements.entries()) {
		const requirement = dataRecord(
			candidate,
			`project feature requirement ${String(index)}`,
		) as unknown as ProjectFeatureRequirement;
		const owned = typeof requirement.id === 'string'
			&& requirement.id.startsWith(SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX);
		if (owned) {
			const exact = expectedById.get(requirement.id);
			if (!exact || !sameRequirement(requirement, exact)) {
				throw new TypeError('A reserved Soundscaper audio-freeze requirement conflicts with project authority.');
			}
			continue;
		}
		if (requirement.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze) {
			throw new TypeError('Publisher substitution for Soundscaper audio-freeze requirements is forbidden.');
		}
		retained.push(requirement);
	}
	if (retained.length + expected.length > PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements) {
		throw new RangeError('Soundscaper audio-freeze requirements exceed the manifest limit.');
	}
	return normalizeProjectFeatureRequirements({
		schemaVersion: 2,
		requirements: [...retained, ...expected],
	}, projectContext(project));
}

/** Require persisted manifests to equal the product-owned reconciliation exactly. */
export function validateSoundscaperProjectFeatureRequirementsV21(
	projectValue: DataRecord,
	label = 'Soundscaper V21 project',
): true {
	const project = dataRecord(projectValue, label);
	const manifest = normalizeProjectFeatureRequirements(
		project.featureRequirements,
		projectContext(project),
	);
	const reconciled = reconcileSoundscaperProjectFeatureRequirementsV21(project, manifest, label);
	if (JSON.stringify(manifest) !== JSON.stringify(reconciled)) {
		throw new RangeError(`${label} audio-freeze requirements are not in exact reconciled form.`);
	}
	return true;
}

/** Rebind only pre-admitted fresh freezes after an administrative source-ID remap. */
export function rebindSoundscaperProjectFreezeSourceIdentitiesV21(
	projectValue: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	if (![...sourceIdMap].some(([sourceId, replacement]) => sourceId !== replacement)) return;
	const project = dataRecord(projectValue, 'Soundscaper V21 project');
	const manifest = dataRecord(project.featureRequirements, 'project.featureRequirements');
	const requirements = dataArray(manifest.requirements, 'project.featureRequirements.requirements');
	const renderedFallbackIds = new Set(requirements
		.filter((requirement) => requirement.disposition === 'rendered-fallback')
		.map((requirement) => stableId(requirement.id, 'project feature requirement')));
	const tracks = dataArray(project.tracks, 'project.tracks');
	const sources = dataArray(project.sources, 'project.sources');
	for (const track of tracks) {
		if (track.type !== 'audio' || !Object.hasOwn(track, 'audioFreeze')) continue;
		const requirementId = soundscaperAudioTrackFreezeRequirementIdV21(track.id);
		if (!renderedFallbackIds.has(requirementId)) continue;
		const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
		const digests = documentFreezeDigests(project, track, freeze, sources);
		(track as Record<string, unknown>).audioFreeze = Object.freeze({ ...freeze, ...digests });
	}
}

function expectedFreezeRequirements(project: DataRecord): readonly ProjectFeatureRequirement[] {
	const tracks = dataArray(project.tracks, 'project.tracks');
	const sources = dataArray(project.sources, 'project.sources');
	const requirements: ProjectFeatureRequirement[] = [];
	const derivedSourceIds = new Set<string>();
	for (const [index, candidate] of tracks.entries()) {
		const track = dataRecord(candidate, `project.tracks[${String(index)}]`);
		if (!Object.hasOwn(track, 'audioFreeze')) continue;
		if (track.type !== 'audio') throw new RangeError('Only an audio track may own audioFreeze.');
		const trackId = stableId(track.id, 'frozen audio track');
		const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
		if (derivedSourceIds.has(freeze.derivedSourceId)) {
			throw new RangeError('Every frozen audio track must own a distinct derived source.');
		}
		derivedSourceIds.add(freeze.derivedSourceId);
		const source = exactRecordById(sources, freeze.derivedSourceId, 'freeze derived source');
		const contentSha256 = digest(source.contentSha256, `derived source ${freeze.derivedSourceId}`);
		const base = Object.freeze({
			id: soundscaperAudioTrackFreezeRequirementIdV21(trackId),
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
			displayName: SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_DISPLAY_NAME,
		});
		const fresh = documentFreezeIsFresh(project, track, freeze, sources);
		requirements.push(fresh ? Object.freeze({
			...base,
			disposition: 'rendered-fallback' as const,
			fallback: Object.freeze({
				role: 'audio-track-render-v1' as const,
				kind: 'audio' as const,
				sourceId: freeze.derivedSourceId,
				sha256: contentSha256,
				targetTrackId: trackId,
			}),
		}) : Object.freeze({
			...base,
			disposition: 'bypass' as const,
			fallback: null,
		}));
	}
	return Object.freeze(requirements);
}

function documentFreezeIsFresh(
	project: DataRecord,
	track: DataRecord,
	freeze: ReturnType<typeof normalizeAudioTrackFreezeV1>,
	sources: readonly DataRecord[],
): boolean {
	try {
		const digests = documentFreezeDigests(project, track, freeze, sources);
		return classifyAudioTrackFreezeFreshnessV1(freeze, digests).status === 'fresh';
	} catch {
		return false;
	}
}

function documentFreezeDigests(
	project: DataRecord,
	track: DataRecord,
	freeze: ReturnType<typeof normalizeAudioTrackFreezeV1>,
	sources: readonly DataRecord[],
): ReturnType<typeof computeAudioTrackFreezeDigestsV1> {
	const clips = dataArray(project.clips, 'project.clips');
	const clipIds = stringArray(track.clipIds, `audio track ${String(track.id)}.clipIds`);
	const sourceIds = new Set<string>();
	for (const clipId of clipIds) {
		const clip = exactRecordById(clips, clipId, 'freeze input clip');
		sourceIds.add(stableId(clip.sourceId, `freeze input clip ${clipId} source`));
	}
	const sourceContentIdentities = Object.freeze(Array.from(sourceIds, (sourceId) => {
		const source = exactRecordById(sources, sourceId, 'freeze input source');
		return Object.freeze({
			sourceId,
			contentSha256: digest(source.contentSha256, `source ${sourceId}`),
		});
	}));
	return computeAudioTrackFreezeDigestsV1({
		sampleRate: Number(project.sampleRate),
		renderStartFrame: freeze.renderStartFrame,
		renderFrameCount: freeze.renderFrameCount,
		track,
		clips,
		sourceContentIdentities,
		automationLanes: dataArray(project.automationLanes, 'project.automationLanes'),
		tempoMap: project.tempoMap ?? null,
	});
}

function projectContext(project: DataRecord): Parameters<typeof normalizeProjectFeatureRequirements>[1] {
	return {
		sources: dataArray(project.sources, 'project.sources'),
		clips: dataArray(project.clips, 'project.clips'),
		tracks: dataArray(project.tracks, 'project.tracks'),
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: dataArray(project.sequences, 'project.sequences'),
		primarySequenceId: project.primarySequenceId,
	};
}

function exactRecordById(values: readonly unknown[], id: string, name: string): DataRecord {
	const matches = values.filter((candidate, index) => (
		dataRecord(candidate, `${name}[${String(index)}]`).id === id
	));
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return dataRecord(matches[0], `${name} ${id}`);
}

function sameRequirement(left: ProjectFeatureRequirement, right: ProjectFeatureRequirement): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function dataArray(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be a nonempty array.`);
	const result = value.map((candidate, index) => stableId(candidate, `${name}[${String(index)}]`));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} contains duplicate IDs.`);
	return result;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} contentSha256 must be a lowercase SHA-256 digest.`);
	}
	return value;
}
