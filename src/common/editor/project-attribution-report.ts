/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
} from './runtime-clip-projection.ts';
import {
	normalizeSourceMetadata,
	normalizeSourceProvenance,
	type SourceAttributionContributionV1,
	type SourceMetadataRecord,
	type SourceMetadataV1,
	type SourceMetadataValue,
	type SourceProvenanceClassification,
} from './source-provenance.ts';

export {
	exportProjectAttributionCsv,
	formatProjectAttributionTime,
	PROJECT_ATTRIBUTION_CSV_COLUMNS,
} from './project-attribution-csv.ts';

export type ProjectAttributionClassification = SourceProvenanceClassification | 'legacy';
export type ProjectAttributionUseKind = 'clip' | 'take-comp' | 'project-bin';

export interface ProjectAttributionTimelineUse {
	readonly kind: Exclude<ProjectAttributionUseKind, 'project-bin'>;
	readonly id: string;
	readonly title: string;
	readonly sequenceId: string;
	readonly sequenceName: string;
	readonly trackId: string;
	readonly trackName: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface ProjectAttributionBinUse {
	readonly kind: 'project-bin';
	readonly id: string;
	readonly title: string;
}

export type ProjectAttributionUse = ProjectAttributionTimelineUse | ProjectAttributionBinUse;

export interface ProjectAttributionSource {
	readonly sourceId: string;
	readonly sourceName: string;
	readonly sourceKind: string;
	readonly mimeType: string;
	readonly classification: ProjectAttributionClassification;
	readonly contributions: readonly SourceAttributionContributionV1[];
	readonly sourceMetadata: SourceMetadataV1;
	readonly warnings: readonly string[];
	readonly uses: readonly ProjectAttributionUse[];
}

export interface ProjectAttributionReport {
	readonly sampleRate: number;
	readonly sources: readonly ProjectAttributionSource[];
}

type DataRecord = Readonly<Record<string, unknown>>;

interface SequenceContext {
	readonly id: string;
	readonly name: string;
	readonly index: number;
	readonly trackIds: readonly string[];
	readonly trackIndex: ReadonlyMap<string, number>;
}

interface InternalTimelineUse extends ProjectAttributionTimelineUse {
	readonly sequenceIndex: number;
	readonly trackIndex: number;
}

interface InternalBinUse extends ProjectAttributionBinUse {
	readonly sequenceIndex: number;
	readonly trackIndex: number;
}

type InternalUse = InternalTimelineUse | InternalBinUse;

interface MutableSourceReport {
	readonly source: DataRecord;
	readonly classification: ProjectAttributionClassification;
	readonly contributions: readonly SourceAttributionContributionV1[];
	readonly sourceMetadata: SourceMetadataV1;
	readonly warnings: readonly string[];
	readonly uses: InternalUse[];
}

/** Derive imported-source credit and exact current timeline uses from a project snapshot. */
export function createProjectAttributionReport(
	project: Readonly<Record<string, unknown>>,
): ProjectAttributionReport {
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const sources = uniqueRecords(project.sources, 'project.sources');
	const clips = records(project.clips, 'project.clips');
	const tracks = uniqueRecords(project.tracks, 'project.tracks');
	const sequenceContexts = sequences(project.sequences, tracks);
	const sequenceById = new Map(sequenceContexts.map((sequence) => [sequence.id, sequence]));
	const sequencesByTrack = indexSequencesByTrack(sequenceContexts);
	const trackByClip = indexTracksByClip(tracks);
	const sourceReports = new Map<string, MutableSourceReport>();

	for (const clip of clips) {
		const clipId = requiredString(clip.id, 'timeline clip ID');
		const sourceId = requiredString(clip.sourceId, 'timeline clip source ID');
		const source = sources.get(sourceId);
		if (!source) throw new ReferenceError('Timeline clip ' + clipId + ' references missing source ' + sourceId + '.');
		const track = trackByClip.get(clipId);
		if (!track) throw new ReferenceError('Timeline clip ' + clipId + ' is not assigned to a media track.');
		const contexts = clipSequenceContexts(clip, track, project, sequenceById, sequencesByTrack);
		const projection = resolveRuntimeClipProjection(
			project as RuntimeClipProject,
			clip as RuntimePersistedClip,
		);
		for (const sequence of contexts) {
			appendUse(sourceReports, sourceId, source, Object.freeze({
				kind: 'clip',
				id: clipId,
				title: optionalString(clip.title) ?? clipId,
				sequenceId: sequence.id,
				sequenceName: sequence.name,
				trackId: requiredString(track.id, 'track ID'),
				trackName: optionalString(track.name) ?? requiredString(track.id, 'track ID'),
				startFrame: projection.timelineStartFrame,
				endFrame: projection.timelineEndFrame,
				sequenceIndex: sequence.index,
				trackIndex: sequence.trackIndex.get(requiredString(track.id, 'track ID')) ?? Number.MAX_SAFE_INTEGER,
			}));
		}
	}

	appendTakeCompUses(project.takeGroups, sources, tracks, sequenceById, sourceReports);
	appendProjectBinUses(project.projectBin, sources, sourceReports);
	const ordered = [...sourceReports.entries()];
	for (const [, entry] of ordered) entry.uses.sort(compareUses);
	ordered.sort(compareMutableSources);
	const result = ordered.map(([sourceId, entry]) => finishSource(sourceId, entry))
		.filter((entry): entry is ProjectAttributionSource => entry !== null);
	return Object.freeze({ sampleRate, sources: Object.freeze(result) });
}

function appendProjectBinUses(
	value: unknown,
	sources: ReadonlyMap<string, DataRecord>,
	reports: Map<string, MutableSourceReport>,
): void {
	if (value == null) return;
	const bin = dataRecord(value, 'project.projectBin');
	for (const [index, clip] of records(bin.clips, 'project.projectBin.clips').entries()) {
		const name = 'project.projectBin.clips[' + String(index) + ']';
		const id = requiredString(clip.id, name + '.id');
		const sourceId = requiredString(clip.sourceId, name + '.sourceId');
		const source = sources.get(sourceId);
		if (!source) throw new ReferenceError(name + ' references missing source ' + sourceId + '.');
		appendUse(reports, sourceId, source, Object.freeze({
			kind: 'project-bin',
			id,
			title: optionalString(clip.title) ?? id,
			sequenceIndex: Number.MAX_SAFE_INTEGER,
			trackIndex: Number.MAX_SAFE_INTEGER,
		}));
	}
}

function appendUse(
	reports: Map<string, MutableSourceReport>,
	sourceId: string,
	source: DataRecord,
	use: InternalUse,
): void {
	const report = reports.get(sourceId) ?? createMutableSourceReport(source);
	report.uses.push(use);
	reports.set(sourceId, report);
}

function createMutableSourceReport(source: DataRecord): MutableSourceReport {
	if (Object.hasOwn(source, 'provenance')) {
		const provenance = normalizeSourceProvenance(source.provenance);
		const metadata = sourceExtensionMetadata(source.opaqueExtensions, 'Source metadata');
		return {
			source,
			classification: provenance.classification,
			contributions: provenance.contributions,
			sourceMetadata: metadata.metadata,
			warnings: metadata.warnings,
			uses: [],
		};
	}
	const legacy = sourceExtensionMetadata(source.opaqueExtensions, 'Legacy metadata');
	return {
		source,
		classification: 'legacy',
		contributions: Object.freeze([]),
		sourceMetadata: legacy.metadata,
		warnings: Object.freeze([
			'Attribution is unavailable because this source predates provenance tracking.',
			...legacy.warnings,
		]),
		uses: [],
	};
}

function finishSource(sourceId: string, entry: MutableSourceReport): ProjectAttributionSource | null {
	if (entry.classification === 'recorded' || entry.classification === 'generated') return null;
	if (entry.classification === 'derived' && entry.contributions.length === 0) return null;
	const sourceName = optionalString(entry.source.name) ?? sourceId;
	return Object.freeze({
		sourceId,
		sourceName,
		sourceKind: optionalString(entry.source.kind) ?? 'unknown',
		mimeType: optionalString(entry.source.mimeType) ?? '',
		classification: entry.classification,
		contributions: entry.contributions,
		sourceMetadata: entry.sourceMetadata,
		warnings: entry.warnings,
		uses: Object.freeze(entry.uses.map(({ sequenceIndex: _sequence, trackIndex: _track, ...use }) => (
			Object.freeze(use)
		))),
	});
}

function appendTakeCompUses(
	value: unknown,
	sources: ReadonlyMap<string, DataRecord>,
	tracks: ReadonlyMap<string, DataRecord>,
	sequences: ReadonlyMap<string, SequenceContext>,
	reports: Map<string, MutableSourceReport>,
): void {
	if (value == null) return;
	for (const [groupIndex, group] of records(value, 'project.takeGroups').entries()) {
		const groupName = 'project.takeGroups[' + String(groupIndex) + ']';
		const sequenceId = requiredString(group.sequenceId, groupName + '.sequenceId');
		const trackId = requiredString(group.trackId, groupName + '.trackId');
		const sequence = sequences.get(sequenceId);
		const track = tracks.get(trackId);
		if (!sequence) throw new ReferenceError(groupName + ' references missing sequence ' + sequenceId + '.');
		if (!track) throw new ReferenceError(groupName + ' references missing track ' + trackId + '.');
		const takes = new Map(records(group.takes, groupName + '.takes').map((take) => [
			requiredString(take.id, groupName + ' take ID'),
			take,
		]));
		for (const [regionIndex, region] of records(group.compRegions, groupName + '.compRegions').entries()) {
			const regionName = groupName + '.compRegions[' + String(regionIndex) + ']';
			const regionId = requiredString(region.id, regionName + '.id');
			const takeId = requiredString(region.takeId, regionName + '.takeId');
			const take = takes.get(takeId);
			if (!take) throw new ReferenceError(regionName + ' references missing take ' + takeId + '.');
			const sourceId = requiredString(take.sourceId, regionName + ' source ID');
			const source = sources.get(sourceId);
			if (!source) throw new ReferenceError(regionName + ' references missing source ' + sourceId + '.');
			const startFrame = nonNegativeSafeInteger(region.startSample, regionName + '.startSample');
			const endFrame = nonNegativeSafeInteger(region.endSample, regionName + '.endSample');
			if (endFrame <= startFrame) throw new RangeError(regionName + ' must have positive extent.');
			appendUse(reports, sourceId, source, Object.freeze({
				kind: 'take-comp',
				id: regionId,
				title: 'Take comp',
				sequenceId,
				sequenceName: sequence.name,
				trackId,
				trackName: optionalString(track.name) ?? trackId,
				startFrame,
				endFrame,
				sequenceIndex: sequence.index,
				trackIndex: sequence.trackIndex.get(trackId) ?? Number.MAX_SAFE_INTEGER,
			}));
		}
	}
}

function sequences(value: unknown, tracks: ReadonlyMap<string, DataRecord>): readonly SequenceContext[] {
	return records(value, 'project.sequences').map((sequence, index) => {
		const id = requiredString(sequence.id, 'project sequence ID');
		const trackIds = strings(sequence.trackIds, 'sequence ' + id + '.trackIds');
		for (const trackId of trackIds) if (!tracks.has(trackId)) {
			throw new ReferenceError('Sequence ' + id + ' references missing track ' + trackId + '.');
		}
		return Object.freeze({
			id,
			name: optionalString(sequence.name) ?? id,
			index,
			trackIds,
			trackIndex: new Map(trackIds.map((trackId, trackIndex) => [trackId, trackIndex])),
		});
	});
}

function indexSequencesByTrack(
	sequences: readonly SequenceContext[],
): ReadonlyMap<string, readonly SequenceContext[]> {
	const mutable = new Map<string, SequenceContext[]>();
	for (const sequence of sequences) {
		for (const trackId of sequence.trackIds) {
			const values = mutable.get(trackId) ?? [];
			values.push(sequence);
			mutable.set(trackId, values);
		}
	}
	return new Map([...mutable].map(([trackId, values]) => [trackId, Object.freeze(values)]));
}

function clipSequenceContexts(
	clip: DataRecord,
	track: DataRecord,
	project: Readonly<Record<string, unknown>>,
	sequenceById: ReadonlyMap<string, SequenceContext>,
	sequencesByTrack: ReadonlyMap<string, readonly SequenceContext[]>,
): readonly SequenceContext[] {
	if (clip.kind === 'video' && typeof clip.sequenceId === 'string') {
		const sequence = sequenceById.get(clip.sequenceId);
		if (!sequence) throw new ReferenceError('Video clip references missing sequence ' + clip.sequenceId + '.');
		return [sequence];
	}
	const trackId = requiredString(track.id, 'track ID');
	const owned = sequencesByTrack.get(trackId);
	if (owned?.length) return owned;
	const primary = optionalString(project.primarySequenceId);
	const fallback = primary ? sequenceById.get(primary) : undefined;
	if (!fallback) throw new ReferenceError('Track ' + trackId + ' does not belong to a project sequence.');
	return [fallback];
}

function indexTracksByClip(tracks: ReadonlyMap<string, DataRecord>): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const track of tracks.values()) {
		if (track.type === 'label') continue;
		for (const clipId of strings(track.clipIds, 'track clip IDs')) {
			if (result.has(clipId)) throw new RangeError('Timeline clip ' + clipId + ' belongs to multiple tracks.');
			result.set(clipId, track);
		}
	}
	return result;
}

function sourceExtensionMetadata(
	value: unknown,
	warningSubject: 'Source metadata' | 'Legacy metadata',
): { metadata: SourceMetadataV1; warnings: readonly string[] } {
	if (value == null) return { metadata: emptyMetadata(), warnings: Object.freeze([]) };
	const input = dataRecord(value, 'source.opaqueExtensions');
	const namespaces: Record<string, SourceMetadataValue> = {};
	const warnings: string[] = [];
	for (const key of Object.keys(input).sort(compareText)) {
		try {
			const normalized = normalizeSourceMetadata({
				namespaces: { [key]: input[key] },
			}, 'source legacy metadata');
			const entry = normalized.namespaces[key];
			if (entry !== undefined) Object.defineProperty(namespaces, key, {
				value: entry,
				enumerable: true,
				writable: true,
				configurable: true,
			});
		} catch {
			warnings.push(warningSubject + ' namespace ' + key + ' is unavailable in the attribution report.');
		}
	}
	return {
		metadata: Object.freeze({
			normalized: Object.freeze({}),
			raw: Object.freeze({}),
			namespaces: Object.freeze(namespaces) as SourceMetadataRecord,
		}),
		warnings: Object.freeze(warnings),
	};
}

function emptyMetadata(): SourceMetadataV1 {
	return Object.freeze({
		normalized: Object.freeze({}),
		raw: Object.freeze({}),
		namespaces: Object.freeze({}),
	});
}

function uniqueRecords(value: unknown, name: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const [index, entry] of records(value, name).entries()) {
		const id = requiredString(entry.id, name + '[' + String(index) + '].id');
		if (result.has(id)) throw new RangeError(name + ' contains duplicate ID ' + id + '.');
		result.set(id, entry);
	}
	return result;
}

function records(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(name + ' must be an array.');
	return value.map((entry, index) => dataRecord(entry, name + '[' + String(index) + ']'));
}

function strings(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError(name + ' must be an array.');
	return value.map((entry, index) => requiredString(entry, name + '[' + String(index) + ']'));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(name + ' must be an object.');
	}
	return value as DataRecord;
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(name + ' must be a non-empty string.');
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(name + ' must be a positive safe integer.');
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(name + ' must be a non-negative safe integer.');
	}
	return Number(value);
}

function compareUses(left: InternalUse, right: InternalUse): number {
	return left.sequenceIndex - right.sequenceIndex
		|| ('startFrame' in left && 'startFrame' in right ? left.startFrame - right.startFrame : 0)
		|| left.trackIndex - right.trackIndex
		|| compareText(left.id, right.id);
}

function compareMutableSources(
	[leftId, left]: readonly [string, MutableSourceReport],
	[rightId, right]: readonly [string, MutableSourceReport],
): number {
	const leftUse = left.uses[0];
	const rightUse = right.uses[0];
	if (leftUse && rightUse) return compareUses(leftUse, rightUse) || compareText(leftId, rightId);
	return leftUse ? -1 : rightUse ? 1 : compareText(leftId, rightId);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
