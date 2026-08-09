/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	pasteSpanForSequence,
	sequenceForTrack,
} from './clipboard-time-runtime.js';
import type { AudioEditorClipboard } from './protocol.ts';
import type { TimelineAnnotationClipboardPasteGeometry } from './timeline-annotation-clipboard.ts';

type DataRecord = Record<string, unknown>;
type IdFactory = (prefix: string) => string;

interface PastePreparationOptions {
	readonly project?: DataRecord;
	readonly trackMap?: Readonly<Record<string, string>>;
	readonly sequenceMap?: Readonly<Record<string, string>>;
}

interface MutablePasteCommand extends DataRecord {
	trackMap?: Record<string, string>;
	sequenceMap?: Record<string, string>;
	annotationIds?: Record<string, string>;
	annotationBatchIds?: Record<string, string>;
}

/** Allocate every V3 identity and derive its source-to-target sequence map. */
export function preparePasteAnnotationMaps(
	clipboard: AudioEditorClipboard,
	options: PastePreparationOptions,
	command: MutablePasteCommand,
	idFactory: IdFactory,
): void {
	if (clipboard.schemaVersion !== 3) return;
	const sourceSequenceIds = new Set([
		...clipboard.tracks.map((track) => requiredId(track.sourceSequenceId, 'clipboard track sourceSequenceId')),
		...(clipboard.annotations || []).map((annotation) => annotation.sourceSequenceId),
	]);
	const suppliedSequenceMap = snapshotDataRecord(options.sequenceMap || {}, 'paste.sequenceMap');
	for (const key of Reflect.ownKeys(suppliedSequenceMap)) {
		if (typeof key !== 'string' || !sourceSequenceIds.has(key)) {
			throw new TypeError(`paste.sequenceMap contains an unexpected source ID: ${String(key)}.`);
		}
	}
	const sequenceMap = nullPrototypeRecord<string | null>();
	for (const sourceSequenceId of sourceSequenceIds) {
		sequenceMap[sourceSequenceId] = Object.hasOwn(suppliedSequenceMap, sourceSequenceId)
			? requiredId(suppliedSequenceMap[sourceSequenceId], `paste.sequenceMap.${sourceSequenceId}`)
			: null;
	}
	if (options.project) {
		for (const track of clipboard.tracks) {
			const sourceSequenceId = requiredId(track.sourceSequenceId, 'clipboard track sourceSequenceId');
			const targetTrackId = options.trackMap?.[track.sourceTrackId] || track.sourceTrackId;
			const targetSequenceId = sequenceIdForTrack(options.project, targetTrackId);
			const mapped = sequenceMap[sourceSequenceId];
			if (mapped && mapped !== targetSequenceId) {
				throw new RangeError(`Clipboard sequence ${sourceSequenceId} cannot map to multiple target sequences.`);
			}
			sequenceMap[sourceSequenceId] = targetSequenceId;
		}
		const sequences = recordArray(options.project.sequences, 'project.sequences');
		for (const sourceSequenceId of sourceSequenceIds) {
			if (sequenceMap[sourceSequenceId]) continue;
			if (sequences.some((sequence) => sequence.id === sourceSequenceId)) sequenceMap[sourceSequenceId] = sourceSequenceId;
		}
	} else {
		for (const sourceSequenceId of sourceSequenceIds) sequenceMap[sourceSequenceId] ||= sourceSequenceId;
	}
	const completeSequenceMap = nullPrototypeRecord<string>();
	for (const sourceSequenceId of sourceSequenceIds) {
		const targetSequenceId = sequenceMap[sourceSequenceId];
		if (!targetSequenceId) throw new TypeError(`A target sequence map is required for ${sourceSequenceId}.`);
		completeSequenceMap[sourceSequenceId] = targetSequenceId;
	}
	command.sequenceMap = serializableRecord(completeSequenceMap);
	const annotationIds = nullPrototypeRecord<string>();
	const annotationBatchIds = nullPrototypeRecord<string>();
	for (const annotation of clipboard.annotations || []) {
		annotationIds[annotation.key] = idFactory('timeline-annotation');
		if (annotation.batchId && !Object.hasOwn(annotationBatchIds, annotation.batchId)) {
			annotationBatchIds[annotation.batchId] = idFactory('timeline-annotation-batch');
		}
	}
	command.annotationIds = serializableRecord(annotationIds);
	command.annotationBatchIds = serializableRecord(annotationBatchIds);
}

/** Bind each copied track context to the actual owning destination sequence. */
export function assertPasteSequenceMaps(
	project: DataRecord,
	clipboard: AudioEditorClipboard,
	command: MutablePasteCommand,
): void {
	if (clipboard.schemaVersion !== 3) return;
	const sequenceMapDescriptor = Object.getOwnPropertyDescriptor(command, 'sequenceMap');
	if (!sequenceMapDescriptor) return;
	if (!sequenceMapDescriptor.enumerable || !Object.hasOwn(sequenceMapDescriptor, 'value')) {
		throw new TypeError('paste.sequenceMap must be an own enumerable data property.');
	}
	const sequenceMap = snapshotDataRecord(sequenceMapDescriptor.value, 'paste.sequenceMap');
	for (const track of clipboard.tracks) {
		const sourceSequenceId = requiredId(track.sourceSequenceId, 'clipboard track sourceSequenceId');
		if (!Object.hasOwn(sequenceMap, sourceSequenceId)) continue;
		const targetTrackId = command.trackMap?.[track.sourceTrackId] || track.sourceTrackId;
		const targetSequenceId = sequenceIdForTrack(project, targetTrackId);
		if (sequenceMap[sourceSequenceId] !== targetSequenceId) {
			throw new RangeError(`Clipboard sequence ${sourceSequenceId} does not map to its target track sequence.`);
		}
	}
}

/** Share the media paste anchors and insert spans with annotation placement. */
export function createAnnotationPasteGeometry(
	project: DataRecord,
	atFrame: number,
	durationFrames: number,
	conformsToVideoGrid: boolean,
	conformedAnchorBySequenceId: ReadonlyMap<string, Readonly<{ readonly sampleFrame?: number }>>,
): TimelineAnnotationClipboardPasteGeometry {
	const placementFrameBySequenceId = new Map<string, number>();
	const insertionSpanBySequenceId = new Map<string, Readonly<{ startFrame: number; endFrame: number }>>();
	const sequences = Array.isArray(project.sequences) ? recordArray(project.sequences, 'project.sequences') : [];
	for (const [index, sequence] of sequences.entries()) {
		const sequenceId = requiredId(sequence.id, `project.sequences[${String(index)}].id`);
		const conformed = conformedAnchorBySequenceId.get(sequenceId);
		placementFrameBySequenceId.set(sequenceId, conformed?.sampleFrame ?? atFrame);
		const span = pasteSpanForSequence(
			project,
			conformsToVideoGrid ? sequence : null,
			atFrame,
			durationFrames,
		) as Readonly<{ startFrame: number; endFrame: number }>;
		insertionSpanBySequenceId.set(sequenceId, span);
	}
	return Object.freeze({ placementFrameBySequenceId, insertionSpanBySequenceId });
}

function sequenceIdForTrack(project: DataRecord, trackId: string): string {
	const tracks = Array.isArray(project.tracks) ? project.tracks : [];
	if (!tracks.some((track) => track && typeof track === 'object' && (track as DataRecord).id === trackId)) {
		return requiredId(project.primarySequenceId, `target sequence for new track ${trackId}`);
	}
	const sequence = sequenceForTrack(project, trackId) as Readonly<{ id?: unknown }>;
	return requiredId(sequence.id, `target sequence for track ${trackId}`);
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return candidate as DataRecord;
	});
}

function snapshotDataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	const entries: Array<readonly [string, unknown]> = [];
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} contains an unsupported field: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
		entries.push([key, descriptor.value]);
	}
	return Object.freeze(Object.fromEntries(entries));
}

function nullPrototypeRecord<Value>(): Record<string, Value> {
	return Object.create(null) as Record<string, Value>;
}

function serializableRecord<Value>(value: Readonly<Record<string, Value>>): Record<string, Value> {
	return Object.fromEntries(Object.entries(value));
}

function requiredId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}
