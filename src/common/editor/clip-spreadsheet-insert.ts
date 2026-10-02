/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from './commands/protocol.ts';
import { CLIP_SPREADSHEET_COLUMNS, type ClipSpreadsheetColumnId } from './clip-spreadsheet.ts';
import { spreadsheetBoolean, spreadsheetDurationFrames, spreadsheetFrames, spreadsheetGain, spreadsheetNumber, spreadsheetSourceDurationFrames } from './clip-spreadsheet-values.ts';
import { createAudioClip, createAudioTrack } from './project-media-factory.ts';

export type ClipSpreadsheetNewRow = Readonly<Partial<Record<ClipSpreadsheetColumnId, string>>>;
export interface ClipSpreadsheetInsertSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly kind?: string;
}
export interface ClipSpreadsheetInsertOptions {
	createId(prefix: string): string;
	readonly resolvedSourceIds?: Readonly<Record<string, string>>;
	readonly additionalSources?: readonly ClipSpreadsheetInsertSource[];
}
interface InsertTrack {
	readonly id: string;
	readonly name: string;
	readonly type?: string;
	readonly locked?: boolean;
}
interface InsertProject {
	readonly sampleRate: number;
	readonly sources: readonly ClipSpreadsheetInsertSource[];
	readonly tracks: readonly InsertTrack[];
	readonly clips: readonly Readonly<{ id: string }>[];
}
interface ParsedRow {
	readonly source: string;
	readonly track: string;
	readonly name: string;
	readonly position: string;
	readonly offset: string;
	readonly duration: string | null;
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly gain: number;
	readonly fadeIn: string;
	readonly fadeOut: string;
	readonly reversed: boolean;
	readonly inverted: boolean;
}

/** Validate supplied values before a caller opens a file picker or reads disk media. */
export function findMissingClipSpreadsheetSources(projectValue: unknown, rows: readonly ClipSpreadsheetNewRow[]): readonly string[] {
	const project = insertProject(projectValue);
	const sources = namedIndex(project.sources);
	const tracks = namedIndex(project.tracks);
	const missing = new Set<string>();
	for (const row of rows.map(parseRow)) {
		timelineFields(project, row);
		const source = resolveNamed(sources, row.source, 'source');
		if (source) validateSource(source);
		else missing.add(row.source);
		const trackName = row.track || source?.name;
		if (trackName) validateTrack(resolveNamed(tracks, trackName, 'track'));
		if (source) clipFields(project, source, row);
	}
	return [...missing];
}

/** Build one replayable batch; prepared imports, new tracks, and clips share its undo. */
export function planClipSpreadsheetInsert(projectValue: unknown, rows: readonly ClipSpreadsheetNewRow[], options: ClipSpreadsheetInsertOptions): AudioEditorCommand | null {
	const project = insertProject(projectValue);
	const parsedRows = rows.map(parseRow);
	if (!parsedRows.length) return null;
	const extras = options.additionalSources ?? [];
	const sources = namedIndex([...project.sources, ...extras]);
	if (sources.ids.size !== project.sources.length + extras.length) throw new RangeError('An imported source ID already exists in the project.');
	const tracks = namedIndex(project.tracks);
	const reserved = new Set([...project.sources, ...project.tracks, ...project.clips, ...extras].map(value => value.id));
	const usedSources = new Set<string>();
	const trackCommands: AudioEditorCommand[] = [];
	const clipCommands: AudioEditorCommand[] = [];
	for (const row of parsedRows) {
		const reference = options.resolvedSourceIds && Object.hasOwn(options.resolvedSourceIds, row.source)
			? options.resolvedSourceIds[row.source]! : row.source;
		const source = resolveNamed(sources, reference, 'source');
		if (!source) throw new RangeError(`The source file is missing: ${row.source}.`);
		validateSource(source);
		const fields = clipFields(project, source, row);
		usedSources.add(source.id);
		const trackName = row.track || source.name;
		let track = resolveNamed(tracks, trackName, 'track');
		validateTrack(track);
		if (!track) {
			const created = createAudioTrack({ id: freshId('track'), name: trackName }, project.sampleRate);
			trackCommands.push({ type: 'track/add', track: created });
			indexNamed(tracks, created);
			track = created;
		}
		clipCommands.push({ type: 'clip/add', trackId: track.id, clip: createAudioClip({
			id: freshId('clip'), sourceId: source.id, title: row.name || source.name, ...fields,
		}) });
	}
	return { type: 'batch', commands: [
		...extras.filter(source => usedSources.has(source.id)).map(source => ({ type: 'source/add' as const, source })),
		...trackCommands, ...clipCommands,
	] };

	function freshId(prefix: string): string {
		const id = options.createId(prefix);
		if (typeof id !== 'string' || !id.trim() || reserved.has(id)) throw new RangeError('Spreadsheet insertion requires fresh stable IDs.');
		reserved.add(id);
		return id;
	}
}

function clipFields(project: InsertProject, source: ClipSpreadsheetInsertSource, row: ParsedRow) {
	const timeline = timelineFields(project, row);
	const { timelineStartFrame, fadeInFrames, fadeOutFrames } = timeline;
	const sourceStartFrame = spreadsheetFrames(row.offset, source.sampleRate, false);
	const availableFrames = source.frameCount - sourceStartFrame;
	const durationFrames = timeline.durationFrames
		?? spreadsheetDurationFrames(availableFrames, source.sampleRate, project.sampleRate, row.speedRatio);
	const sourceDurationFrames = row.duration === null ? availableFrames
		: spreadsheetSourceDurationFrames(durationFrames, project.sampleRate, source.sampleRate, row.speedRatio);
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 1 || !Number.isSafeInteger(sourceDurationFrames) || sourceDurationFrames < 1) throw new RangeError('Clip duration must contain at least one sample.');
	if (sourceStartFrame + sourceDurationFrames > source.frameCount) throw new RangeError('Clip offset and duration exceed the source file.');
	if (!Number.isSafeInteger(timelineStartFrame + durationFrames)) throw new RangeError('Clip position and duration exceed the supported timeline.');
	if (fadeInFrames > durationFrames || fadeOutFrames > durationFrames) throw new RangeError('A fade cannot be longer than the clip.');
	return {
		timelineStartFrame, sourceStartFrame, sourceDurationFrames, durationFrames,
		pitchCents: row.pitchCents, speedRatio: row.speedRatio, gain: row.gain,
		fadeInFrames, fadeOutFrames, reversed: row.reversed, inverted: row.inverted,
		trimStartFrames: sourceStartFrame, trimEndFrames: source.frameCount - sourceStartFrame - sourceDurationFrames,
	};
}

function timelineFields(project: InsertProject, row: ParsedRow) {
	const timelineStartFrame = spreadsheetFrames(row.position, project.sampleRate, false);
	const durationFrames = row.duration === null ? null : spreadsheetFrames(row.duration, project.sampleRate, true);
	if (durationFrames !== null && !Number.isSafeInteger(timelineStartFrame + durationFrames)) throw new RangeError('Clip position and duration exceed the supported timeline.');
	return {
		timelineStartFrame, durationFrames,
		fadeInFrames: spreadsheetFrames(row.fadeIn, project.sampleRate, false),
		fadeOutFrames: spreadsheetFrames(row.fadeOut, project.sampleRate, false),
	};
}

function parseRow(row: ClipSpreadsheetNewRow): ParsedRow {
	if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('A spreadsheet row must contain clip properties.');
	for (const [key, value] of Object.entries(row)) {
		if (!CLIP_SPREADSHEET_COLUMNS.some(column => column.id === key) || typeof value !== 'string') throw new TypeError('Spreadsheet rows require known columns with text values.');
	}
	const source = row.source?.trim() ?? '';
	if (!source) throw new RangeError('A source file is required for each new clip.');
	const text = (key: ClipSpreadsheetColumnId, fallback: string): string => row[key]?.trim() || fallback;
	const position = text('position', '0');
	const offset = text('offset', '0');
	const duration = text('duration', '') || null;
	const fadeIn = text('fadeIn', '0');
	const fadeOut = text('fadeOut', '0');
	for (const value of [position, offset, fadeIn, fadeOut]) spreadsheetNumber(value, 0, Number.MAX_SAFE_INTEGER, 'Time');
	if (duration !== null) {
		const seconds = spreadsheetNumber(duration, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'Duration');
		if (Number(fadeIn) > seconds || Number(fadeOut) > seconds) throw new RangeError('A fade cannot be longer than the clip.');
	}
	return {
		source, track: text('track', ''), name: text('name', ''), position, offset, duration, fadeIn, fadeOut,
		pitchCents: spreadsheetNumber(text('pitch', '0'), -12, 12, 'Pitch') * 100,
		speedRatio: spreadsheetNumber(text('speed', '1'), 0.001, 1_000, 'Speed'),
		gain: spreadsheetGain(text('gain', '0')),
		reversed: spreadsheetBoolean(text('reversed', 'false')), inverted: spreadsheetBoolean(text('inverted', 'false')),
	};
}

function validateSource(source: ClipSpreadsheetInsertSource): void {
	if (source.kind !== undefined && source.kind !== 'audio') throw new RangeError('New spreadsheet rows require audio source files.');
	for (const value of [source.sampleRate, source.frameCount, source.channelCount]) {
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('The source file has invalid audio metadata.');
	}
}
function validateTrack(track: InsertTrack | undefined): void {
	if (!track) return;
	if (track.type !== undefined && track.type !== 'audio') throw new RangeError('New audio clips require an audio track.');
	if (track.locked) throw new RangeError('The destination track is locked.');
}
function insertProject(value: unknown): InsertProject {
	if (!value || typeof value !== 'object') throw new RangeError('An open project is required.');
	return value as InsertProject;
}
interface NamedIndex<Value> { readonly ids: Map<string, Value>; readonly names: Map<string, Value[]> }
function namedIndex<Value extends { readonly id: string; readonly name: string }>(values: readonly Value[]): NamedIndex<Value> {
	const index: NamedIndex<Value> = { ids: new Map(), names: new Map() };
	for (const value of values) indexNamed(index, value);
	return index;
}
function indexNamed<Value extends { readonly id: string; readonly name: string }>(index: NamedIndex<Value>, value: Value): void {
	index.ids.set(value.id, value);
	const matches = index.names.get(value.name) ?? [];
	matches.push(value);
	index.names.set(value.name, matches);
}
function resolveNamed<Value>(index: NamedIndex<Value>, reference: string, label: string): Value | undefined {
	const byId = index.ids.get(reference);
	if (byId) return byId;
	const matches = index.names.get(reference) ?? [];
	if (matches.length > 1) throw new RangeError(`The ${label} name is ambiguous; use its ID: ${reference}.`);
	return matches[0];
}
