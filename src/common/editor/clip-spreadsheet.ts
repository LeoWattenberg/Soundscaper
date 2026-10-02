/* SPDX-License-Identifier: AGPL-3.0-only */

import { spreadsheetBoolean as booleanValue, spreadsheetFrames as frames, spreadsheetNumber as numeric, spreadsheetGain, spreadsheetDurationFrames, spreadsheetSourceDurationFrames } from './clip-spreadsheet-values.ts';
import { envelopeForTrimmedBounds } from './commands/shared-runtime.js';
import type { AudioEditorCommand, CommandObject } from './commands/protocol.ts';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';
import { scaleSampleFrame } from './timeline-time.ts';

export const CLIP_SPREADSHEET_COLUMNS = [
	{ id: 'name', copyKey: 'name', editable: true },
	{ id: 'track', copyKey: 'track', editable: true },
	{ id: 'position', copyKey: 'position', editable: true },
	{ id: 'source', copyKey: 'source', editable: true },
	{ id: 'offset', copyKey: 'offset', editable: true },
	{ id: 'duration', copyKey: 'duration', editable: true },
	{ id: 'pitch', copyKey: 'pitch', editable: true },
	{ id: 'speed', copyKey: 'speed', editable: true },
	{ id: 'gain', copyKey: 'gain', editable: true },
	{ id: 'fadeIn', copyKey: 'fadeIn', editable: true },
	{ id: 'fadeOut', copyKey: 'fadeOut', editable: true },
	{ id: 'reversed', copyKey: 'reversed', editable: true },
	{ id: 'inverted', copyKey: 'inverted', editable: true },
] as const;

export type ClipSpreadsheetColumnId = typeof CLIP_SPREADSHEET_COLUMNS[number]['id'];
export interface ClipSpreadsheetRow {
	readonly id: string;
	readonly kind: string;
	readonly editable: boolean;
	readonly pitchLinked?: boolean;
	readonly cells: Readonly<Record<ClipSpreadsheetColumnId, string>>;
}
export interface ClipSpreadsheetEdit {
	readonly clipId: string;
	readonly column: ClipSpreadsheetColumnId;
	readonly value: string;
}
interface SpreadsheetClip {
	readonly id: string;
	readonly kind?: string;
	readonly title: string;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly trimStartFrames: number;
	readonly trimEndFrames: number;
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly gain: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly reversed: boolean;
	readonly inverted: boolean;
	readonly renderCacheRevision: number;
	readonly envelope: readonly Readonly<{ frame: number; value: number }>[];
	readonly groupId?: string | null;
	readonly avLinkId?: string | null;
	readonly warpMap?: unknown;
	readonly linkPitchAndTempo?: boolean;
}
interface SpreadsheetSource {
	readonly id: string;
	readonly kind?: string;
	readonly name: string;
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly frameRate?: Readonly<{ num: number; den: number }>;
}
interface SpreadsheetProject {
	readonly sampleRate: number;
	readonly clips: readonly SpreadsheetClip[];
	readonly sources: readonly SpreadsheetSource[];
	readonly tracks: readonly Readonly<{ id: string; name: string; type?: string; clipIds?: readonly string[]; locked?: boolean }>[];
}

export interface ClipSpreadsheetEditOptions {
	readonly additionalSources?: readonly SpreadsheetSource[];
	readonly resolvedSourceIds?: Readonly<Record<string, string>>;
}

/** Resolve persisted musical anchors before exposing seconds to the table. */
export function getClipSpreadsheetRows(projectValue: unknown): readonly ClipSpreadsheetRow[] {
	if (projectValue == null) return [];
	const project = runtimeProject(projectValue);
	return rowsForProject(project, new Map(project.sources.map(source => [source.id, source])));
}

function rowsForProject(project: SpreadsheetProject, sources: ReadonlyMap<string, SpreadsheetSource>): readonly ClipSpreadsheetRow[] {
	const clipsByTrack = new Map(project.tracks.map(track => [track.id, [] as SpreadsheetClip[]]));
	const owners = new Map(project.tracks.flatMap(track => (track.clipIds ?? []).map(id => [id, track.id] as const)));
	// Track clipIds are re-sorted after moves; the clip array preserves identity order.
	for (const clip of project.clips) {
		const owner = owners.get(clip.id);
		if (owner) clipsByTrack.get(owner)?.push(clip);
	}
	return project.tracks.flatMap(track => {
		return (clipsByTrack.get(track.id) ?? []).map(clip => {
			const source = sources.get(clip.sourceId);
			const audio = clip.kind === 'audio' || clip.kind == null;
			const sourceRate = !audio && source?.frameRate
				? source.frameRate.num / source.frameRate.den : source?.sampleRate || project.sampleRate;
			return {
				id: clip.id, kind: clip.kind ?? 'audio', editable: audio && !track.locked, pitchLinked: Boolean(clip.linkPitchAndTempo),
				cells: {
					name: clip.title || source?.name || '', track: track.id,
					position: numberText(clip.timelineStartFrame / project.sampleRate), source: clip.sourceId,
					offset: numberText(clip.sourceStartFrame / sourceRate),
					duration: numberText(clip.durationFrames / project.sampleRate),
					pitch: audio ? numberText(clip.linkPitchAndTempo ? 12 * Math.log2(clip.speedRatio) : clip.pitchCents / 100) : '',
					speed: numberText(clip.speedRatio), gain: audio ? (clip.gain === 0 ? '-Infinity' : numberText(Number((20 * Math.log10(clip.gain)).toPrecision(12)))) : '',
					fadeIn: audio ? numberText(clip.fadeInFrames / project.sampleRate) : '',
					fadeOut: audio ? numberText(clip.fadeOutFrames / project.sampleRate) : '',
					reversed: audio ? String(clip.reversed) : '', inverted: audio ? String(clip.inverted) : '',
				},
			};
		});
	});
}

export function isClipSpreadsheetCellEditable(row: ClipSpreadsheetRow, column: ClipSpreadsheetColumnId): boolean {
	return row.editable && !(column === 'pitch' && row.pitchLinked) && Boolean(CLIP_SPREADSHEET_COLUMNS.find(candidate => candidate.id === column)?.editable);
}

/** Validate the entire paste before producing one undoable command. */
export function planClipSpreadsheetEdits(projectValue: unknown, edits: readonly ClipSpreadsheetEdit[], options: ClipSpreadsheetEditOptions = {}): AudioEditorCommand | null {
	return planEdits(projectValue, edits, options);
}

/** Validate edits before requesting disk files whose metadata is not available yet. */
export function findMissingClipSpreadsheetEditSources(projectValue: unknown, edits: readonly ClipSpreadsheetEdit[]): readonly string[] {
	const missing = new Set<string>();
	planEdits(projectValue, edits, {}, missing);
	return [...missing];
}

function planEdits(projectValue: unknown, edits: readonly ClipSpreadsheetEdit[], options: ClipSpreadsheetEditOptions, missing?: Set<string>): AudioEditorCommand | null {
	const project = runtimeProject(projectValue);
	const sources = new Map([...project.sources, ...options.additionalSources ?? []].map(source => [source.id, source]));
	const rows = new Map(rowsForProject(project, sources).map(row => [row.id, row]));
	const values = new Map<string, Map<ClipSpreadsheetColumnId, string>>();
	for (const edit of edits) {
		const row = rows.get(edit.clipId);
		if (!row) throw new RangeError('The clip is no longer in this project.');
		if (!CLIP_SPREADSHEET_COLUMNS.some(column => column.id === edit.column)) throw new RangeError('Unknown spreadsheet column.');
		const sameNumericValue = !['name', 'track', 'source', 'reversed', 'inverted'].includes(edit.column)
			&& edit.value.trim() !== '' && row.cells[edit.column] !== ''
			&& Number(edit.value) === Number(row.cells[edit.column]);
		const sameIdentifier = (edit.column === 'track' || edit.column === 'source') && edit.value.trim() === row.cells[edit.column];
		if (row.cells[edit.column] === edit.value || sameNumericValue || sameIdentifier) {
			// An explicitly pasted duration stays authoritative when speed changes too.
			if (edit.column === 'duration' && row.editable) {
				const clipValues = values.get(edit.clipId) ?? new Map<ClipSpreadsheetColumnId, string>();
				clipValues.set(edit.column, edit.value);
				values.set(edit.clipId, clipValues);
			} else values.get(edit.clipId)?.delete(edit.column);
			continue;
		}
		if (!isClipSpreadsheetCellEditable(row, edit.column)) throw new RangeError('This spreadsheet cell is read-only.');
		const clipValues = values.get(edit.clipId) ?? new Map<ClipSpreadsheetColumnId, string>();
		clipValues.set(edit.column, edit.value);
		values.set(edit.clipId, clipValues);
	}
	const transforms: { clipId: string; trackId?: string; changes: CommandObject }[] = [];
	const updates: AudioEditorCommand[] = [];
	for (const clip of project.clips) {
		const fields = values.get(clip.id);
		if (!fields?.size) continue;
		const originalSource = sources.get(clip.sourceId);
		if (!originalSource) throw new RangeError('The clip source is missing.');
		let source = originalSource;
		if (fields.has('source')) {
			const reference = fields.get('source')!.trim();
			if (!reference) throw new RangeError('A source file is required.');
			const resolvedReference = options.resolvedSourceIds && Object.hasOwn(options.resolvedSourceIds, reference)
				? options.resolvedSourceIds[reference]! : reference;
			const target = sourceForReference(sources, resolvedReference);
			if (!target) {
				if (!missing) throw new RangeError(`The source file is missing: ${reference}.`);
				missing.add(reference);
				source = { ...originalSource, id: reference, frameCount: Number.MAX_SAFE_INTEGER };
			} else source = target;
		}
		validateSource(source);
		const trackId = fields.get('track')?.trim();
		if (fields.has('track')) {
			const track = project.tracks.find(candidate => candidate.id === trackId);
			if (!track) throw new RangeError(`Unknown destination track ID: ${trackId ?? ''}.`);
			if (track.locked) throw new RangeError('The destination track is locked.');
			if (!Array.isArray(track.clipIds) || track.type !== undefined && track.type !== 'audio') throw new RangeError('Audio clips require an audio destination track.');
			if (clip.groupId || clip.avLinkId) throw new RangeError('Ungroup or unlink this clip before moving it in the spreadsheet.');
		}
		const { transform, update } = planClip(project, clip, source, originalSource.sampleRate, fields);
		if (Object.keys(transform).length || trackId) transforms.push({ clipId: clip.id, ...(trackId ? { trackId } : {}), changes: transform });
		if (Object.keys(update).length) updates.push({ type: 'clip/update', clipId: clip.id, changes: update });
	}
	const commands: AudioEditorCommand[] = [
		...(transforms.length ? [{ type: 'clip/transform-many' as const, transforms }] : []), ...updates,
	];
	return commands.length > 1 ? { type: 'batch', commands } : commands[0] ?? null;
}

function planClip(project: SpreadsheetProject, clip: SpreadsheetClip, source: SpreadsheetSource, originalSourceRate: number, fields: ReadonlyMap<ClipSpreadsheetColumnId, string>) {
	const transform: Record<string, unknown> = {};
	const update: Record<string, unknown> = {};
	const sourceRate = source.sampleRate || project.sampleRate;
	const sourceChanged = source.id !== clip.sourceId;
	let durationFrames = clip.durationFrames;
	let sourceDurationFrames = sourceChanged ? scaleSampleFrame(clip.sourceDurationFrames, originalSourceRate, sourceRate, 'point') : clip.sourceDurationFrames;
	let sourceStartFrame = sourceChanged ? scaleSampleFrame(clip.sourceStartFrame, originalSourceRate, sourceRate, 'point') : clip.sourceStartFrame;
	let speedRatio = clip.speedRatio;
	const set = (target: Record<string, unknown>, key: keyof SpreadsheetClip, value: unknown) => {
		if (value !== clip[key]) target[key] = value;
	};
	set(transform, 'sourceId', source.id);
	for (const [column, raw] of fields) {
		if (column === 'name') {
			const title = raw.trim();
			if (!title) throw new RangeError('A clip name is required.');
			set(update, 'title', title);
		} else if (column === 'position') set(transform, 'timelineStartFrame', frames(raw, project.sampleRate, false));
		else if (column === 'offset') sourceStartFrame = frames(raw, sourceRate, false);
		else if (column === 'duration') durationFrames = frames(raw, project.sampleRate, true);
		else if (column === 'speed') speedRatio = numeric(raw, 0.001, 1_000, 'Speed');
		else if (column === 'pitch') {
			if (clip.linkPitchAndTempo) throw new RangeError('Edit the speed of a clip whose pitch and tempo are linked.');
			set(transform, 'pitchCents', numeric(raw, -12, 12, 'Pitch') * 100);
		} else if (column === 'gain') {
			const gain = spreadsheetGain(raw);
			if (Math.abs(gain - clip.gain) > 1e-12) update.gain = gain;
		} else if (column === 'reversed' || column === 'inverted') set(update, column, booleanValue(raw));
	}
	const speedChanged = speedRatio !== clip.speedRatio;
	const durationRequested = fields.has('duration');
	if (sourceChanged && !speedChanged || durationRequested && (durationFrames !== clip.durationFrames || speedChanged)) {
		sourceDurationFrames = spreadsheetSourceDurationFrames(durationFrames, project.sampleRate, sourceRate, speedRatio);
	} else if (speedChanged) durationFrames = spreadsheetDurationFrames(sourceDurationFrames, sourceRate, project.sampleRate, speedRatio);
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 1 || !Number.isSafeInteger(sourceDurationFrames) || sourceDurationFrames < 1) throw new RangeError('Clip duration must contain at least one sample.');
	if (sourceStartFrame + sourceDurationFrames > source.frameCount) throw new RangeError('Clip offset and duration exceed the source file.');
	set(transform, 'sourceStartFrame', sourceStartFrame);
	set(transform, 'sourceDurationFrames', sourceDurationFrames);
	if (sourceChanged) {
		set(transform, 'trimStartFrames', sourceStartFrame);
		set(transform, 'trimEndFrames', source.frameCount - sourceStartFrame - sourceDurationFrames);
	} else if (sourceStartFrame !== clip.sourceStartFrame || sourceDurationFrames !== clip.sourceDurationFrames) {
		set(transform, 'trimStartFrames', Math.max(0, clip.trimStartFrames + sourceStartFrame - clip.sourceStartFrame));
		set(transform, 'trimEndFrames', Math.max(0, clip.trimEndFrames + clip.sourceStartFrame + clip.sourceDurationFrames - sourceStartFrame - sourceDurationFrames));
	}
	set(transform, 'durationFrames', durationFrames);
	set(transform, 'speedRatio', speedRatio);
	for (const [column, field] of [['fadeIn', 'fadeInFrames'], ['fadeOut', 'fadeOutFrames']] as const) {
		const value = fields.has(column) ? frames(fields.get(column)!, project.sampleRate, false) : Math.min(clip[field], durationFrames);
		if (value > durationFrames) throw new RangeError('A fade cannot be longer than the clip.');
		set(transform, field, value);
	}
	const timingChanged = ['sourceId', 'timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames'].some(key => Object.hasOwn(transform, key));
	if (timingChanged && (clip.groupId || clip.avLinkId)) throw new RangeError('Ungroup or unlink this clip before editing its timing in the spreadsheet.');
	if (clip.warpMap != null && ['sourceId', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames', 'speedRatio'].some(key => Object.hasOwn(transform, key))) throw new RangeError('Edit warped clip timing in the source editor.');
	if (durationFrames !== clip.durationFrames || speedChanged) {
		const previousSourceDuration = sourceChanged ? scaleSampleFrame(clip.sourceDurationFrames, originalSourceRate, sourceRate, 'point') : clip.sourceDurationFrames;
		const stretchedDuration = speedChanged
			? Math.max(1, spreadsheetDurationFrames(previousSourceDuration, sourceRate, project.sampleRate, speedRatio))
			: clip.durationFrames;
		const points = new Map<number, { frame: number; value: number }>();
		for (const point of clip.envelope) {
			const frame = Math.round(point.frame * stretchedDuration / clip.durationFrames);
			points.set(frame, { ...point, frame });
		}
		transform.envelope = envelopeForTrimmedBounds({ ...clip, durationFrames: stretchedDuration, envelope: [...points.values()] }, clip.timelineStartFrame, durationFrames);
	}
	if (['sourceId', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames', 'speedRatio', 'pitchCents'].some(key => Object.hasOwn(transform, key))) transform.renderCacheRevision = clip.renderCacheRevision + 1;
	return { transform, update };
}

function sourceForReference(sources: ReadonlyMap<string, SpreadsheetSource>, reference: string): SpreadsheetSource | undefined {
	const byId = sources.get(reference);
	if (byId) return byId;
	const byName = [...sources.values()].filter(source => source.name === reference);
	if (byName.length > 1) throw new RangeError(`The source name is ambiguous; use its ID: ${reference}.`);
	return byName[0];
}

function validateSource(source: SpreadsheetSource): void {
	if (source.kind !== undefined && source.kind !== 'audio') throw new RangeError('Spreadsheet edits require an audio source file.');
	for (const value of [source.sampleRate, source.frameCount, source.channelCount]) {
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('The source file has invalid audio metadata.');
	}
}

function runtimeProject(project: unknown): SpreadsheetProject {
	if (!project || typeof project !== 'object') throw new RangeError('An open project is required.');
	return projectForRuntimeConsumers(project as RuntimeClipProject) as unknown as SpreadsheetProject;
}
function numberText(value: number): string { return Number.isFinite(value) ? String(value) : ''; }
