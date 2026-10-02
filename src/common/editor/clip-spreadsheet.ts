/* SPDX-License-Identifier: AGPL-3.0-only */

import { envelopeForTrimmedBounds } from './commands/shared-runtime.js';
import type { AudioEditorCommand, CommandObject } from './commands/protocol.ts';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';

export const CLIP_SPREADSHEET_COLUMNS = [
	{ id: 'name', copyKey: 'name', editable: true },
	{ id: 'track', copyKey: 'track', editable: false },
	{ id: 'position', copyKey: 'position', editable: true },
	{ id: 'source', copyKey: 'source', editable: false },
	{ id: 'offset', copyKey: 'offset', editable: true },
	{ id: 'duration', copyKey: 'duration', editable: true },
	{ id: 'pitch', copyKey: 'pitch', editable: true },
	{ id: 'speed', copyKey: 'speed', editable: true },
	{ id: 'gain', copyKey: 'gain', editable: true },
	{ id: 'fadeIn', copyKey: 'fadeIn', editable: true },
	{ id: 'fadeOut', copyKey: 'fadeOut', editable: true },
	{ id: 'reversed', copyKey: 'reversed', editable: true },
	{ id: 'inverted', copyKey: 'inverted', editable: true },
	{ id: 'sampleRate', copyKey: 'sampleRate', editable: false },
	{ id: 'channels', copyKey: 'channels', editable: false },
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
	readonly tracks: readonly Readonly<{ id: string; name: string; clipIds?: readonly string[]; locked?: boolean }>[];
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
					name: clip.title || source?.name || '', track: track.name,
					position: numberText(clip.timelineStartFrame / project.sampleRate), source: source?.name ?? clip.sourceId,
					offset: numberText(clip.sourceStartFrame / sourceRate),
					duration: numberText(clip.durationFrames / project.sampleRate),
					pitch: audio ? numberText(clip.linkPitchAndTempo ? 12 * Math.log2(clip.speedRatio) : clip.pitchCents / 100) : '',
					speed: numberText(clip.speedRatio), gain: audio ? (clip.gain === 0 ? '-Infinity' : numberText(Number((20 * Math.log10(clip.gain)).toPrecision(12)))) : '',
					fadeIn: audio ? numberText(clip.fadeInFrames / project.sampleRate) : '',
					fadeOut: audio ? numberText(clip.fadeOutFrames / project.sampleRate) : '',
					reversed: audio ? String(clip.reversed) : '', inverted: audio ? String(clip.inverted) : '',
					sampleRate: source?.sampleRate == null ? '' : String(source.sampleRate),
					channels: source?.channelCount == null ? '' : String(source.channelCount),
				},
			};
		});
	});
}

export function isClipSpreadsheetCellEditable(row: ClipSpreadsheetRow, column: ClipSpreadsheetColumnId): boolean {
	return row.editable && !(column === 'pitch' && row.pitchLinked) && Boolean(CLIP_SPREADSHEET_COLUMNS.find(candidate => candidate.id === column)?.editable);
}

/** Validate the entire paste before producing one undoable command. */
export function planClipSpreadsheetEdits(projectValue: unknown, edits: readonly ClipSpreadsheetEdit[]): AudioEditorCommand | null {
	const project = runtimeProject(projectValue);
	const sources = new Map(project.sources.map(source => [source.id, source]));
	const rows = new Map(rowsForProject(project, sources).map(row => [row.id, row]));
	const values = new Map<string, Map<ClipSpreadsheetColumnId, string>>();
	for (const edit of edits) {
		const row = rows.get(edit.clipId);
		if (!row) throw new RangeError('The clip is no longer in this project.');
		if (!CLIP_SPREADSHEET_COLUMNS.some(column => column.id === edit.column)) throw new RangeError('Unknown spreadsheet column.');
		const sameNumericValue = !['name', 'track', 'source', 'reversed', 'inverted'].includes(edit.column)
			&& edit.value.trim() !== '' && row.cells[edit.column] !== ''
			&& Number(edit.value) === Number(row.cells[edit.column]);
		if (row.cells[edit.column] === edit.value || sameNumericValue) {
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
	const transforms: { clipId: string; changes: CommandObject }[] = [];
	const updates: AudioEditorCommand[] = [];
	for (const clip of project.clips) {
		const fields = values.get(clip.id);
		if (!fields?.size) continue;
		const source = sources.get(clip.sourceId);
		if (!source) throw new RangeError('The clip source is missing.');
		const { transform, update } = planClip(project, clip, source, fields);
		if (Object.keys(transform).length) transforms.push({ clipId: clip.id, changes: transform });
		if (Object.keys(update).length) updates.push({ type: 'clip/update', clipId: clip.id, changes: update });
	}
	const commands: AudioEditorCommand[] = [
		...(transforms.length ? [{ type: 'clip/transform-many' as const, transforms }] : []), ...updates,
	];
	return commands.length > 1 ? { type: 'batch', commands } : commands[0] ?? null;
}

function planClip(project: SpreadsheetProject, clip: SpreadsheetClip, source: SpreadsheetSource, fields: ReadonlyMap<ClipSpreadsheetColumnId, string>) {
	const transform: Record<string, unknown> = {};
	const update: Record<string, unknown> = {};
	const sourceRate = source.sampleRate || project.sampleRate;
	let durationFrames = clip.durationFrames;
	let sourceDurationFrames = clip.sourceDurationFrames;
	let sourceStartFrame = clip.sourceStartFrame;
	let speedRatio = clip.speedRatio;
	const set = (target: Record<string, unknown>, key: keyof SpreadsheetClip, value: unknown) => {
		if (value !== clip[key]) target[key] = value;
	};
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
			const gain = raw.trim().toLowerCase() === '-infinity' || raw.trim() === '-∞' ? 0 : 10 ** (numeric(raw, -1_000, 20 * Math.log10(16), 'Gain') / 20);
			if (Math.abs(gain - clip.gain) > 1e-12) update.gain = gain;
		} else if (column === 'reversed' || column === 'inverted') set(update, column, booleanValue(raw));
	}
	const speedChanged = speedRatio !== clip.speedRatio;
	const durationRequested = fields.has('duration');
	if (durationRequested && (durationFrames !== clip.durationFrames || speedChanged)) {
		sourceDurationFrames = Math.round(durationFrames / project.sampleRate * speedRatio * sourceRate);
	} else if (speedChanged) durationFrames = Math.round(sourceDurationFrames / sourceRate * project.sampleRate / speedRatio);
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 1 || !Number.isSafeInteger(sourceDurationFrames) || sourceDurationFrames < 1) throw new RangeError('Clip duration must contain at least one sample.');
	if (sourceStartFrame + sourceDurationFrames > source.frameCount) throw new RangeError('Clip offset and duration exceed the source file.');
	set(transform, 'sourceStartFrame', sourceStartFrame);
	set(transform, 'sourceDurationFrames', sourceDurationFrames);
	if (sourceStartFrame !== clip.sourceStartFrame || sourceDurationFrames !== clip.sourceDurationFrames) {
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
	const timingChanged = ['timelineStartFrame', 'sourceStartFrame', 'sourceDurationFrames', 'durationFrames'].some(key => Object.hasOwn(transform, key));
	if (timingChanged && (clip.groupId || clip.avLinkId)) throw new RangeError('Ungroup or unlink this clip before editing its timing in the spreadsheet.');
	if (clip.warpMap != null && ['sourceStartFrame', 'sourceDurationFrames', 'durationFrames', 'speedRatio'].some(key => Object.hasOwn(transform, key))) throw new RangeError('Edit warped clip timing in the source editor.');
	if (durationFrames !== clip.durationFrames || speedChanged) {
		const stretchedDuration = speedChanged
			? Math.max(1, Math.round(clip.sourceDurationFrames / sourceRate * project.sampleRate / speedRatio))
			: clip.durationFrames;
		const points = new Map<number, { frame: number; value: number }>();
		for (const point of clip.envelope) {
			const frame = Math.round(point.frame * stretchedDuration / clip.durationFrames);
			points.set(frame, { ...point, frame });
		}
		transform.envelope = envelopeForTrimmedBounds({ ...clip, durationFrames: stretchedDuration, envelope: [...points.values()] }, clip.timelineStartFrame, durationFrames);
	}
	if (['sourceStartFrame', 'sourceDurationFrames', 'durationFrames', 'speedRatio', 'pitchCents'].some(key => Object.hasOwn(transform, key))) transform.renderCacheRevision = clip.renderCacheRevision + 1;
	return { transform, update };
}

function runtimeProject(project: unknown): SpreadsheetProject {
	if (!project || typeof project !== 'object') throw new RangeError('An open project is required.');
	return projectForRuntimeConsumers(project as RuntimeClipProject) as unknown as SpreadsheetProject;
}
function numberText(value: number): string { return Number.isFinite(value) ? String(value) : ''; }
function numeric(raw: string, minimum: number, maximum: number, label: string): number {
	const value = Number(raw.trim());
	if (!raw.trim() || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be between ${String(minimum)} and ${String(maximum)}.`);
	return value;
}
function frames(raw: string, rate: number, positive: boolean): number {
	const value = Math.round(numeric(raw, 0, Number.MAX_SAFE_INTEGER / rate, 'Time') * rate);
	if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new RangeError('Time must resolve to a valid sample position.');
	return value;
}
function booleanValue(raw: string): boolean {
	if (/^(true|yes|1)$/i.test(raw.trim())) return true;
	if (/^(false|no|0)$/i.test(raw.trim())) return false;
	throw new RangeError('Boolean cells accept true or false.');
}
