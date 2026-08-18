/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admitAudioEditorProjectV9ValidationStructure,
	resolveAudioEditorProjectV9ValidationLimits,
} from './project-v9-validation-budget.ts';

/**
 * Mastering sequences: the order an album's regions are delivered in.
 *
 * A mastering sequence is an ordered list of entries, each pointing at one V11
 * timeline region, each carrying the delivery metadata and the gap and fades
 * that belong to that entry rather than to the region.
 *
 * **Regions are consumed by reference, never copied.** An entry stores the
 * annotation's identity and nothing about where it sits in time. Copying the
 * time range would create a second, quietly diverging answer to "where does this
 * piece start", and the region model already owns that question — including the
 * musical anchoring this module deliberately knows nothing about.
 *
 * **A sequence never repairs itself.** If a region is deleted or moved out from
 * under an entry, the entry stays exactly where it is and validation says what
 * happened. Shrinking a sequence because its underlying region vanished would
 * silently change a delivery order the operator authored, which is the one
 * failure this design exists to prevent.
 *
 * **The sequence owns ordering and metadata only.** No audio, no render
 * settings, no loudness targets: what a delivery does with the order is the
 * delivery's business (6A-1b), and loudness is 6A-2's.
 */

export const MASTERING_SEQUENCE_LIMITS = Object.freeze({
	maximumEntries: 4_096,
	maximumIdCodeUnits: 256,
	maximumTitleCodeUnits: 4_096,
	maximumMetadataEntries: 64,
	maximumMetadataKeyCodeUnits: 128,
	maximumMetadataValueCodeUnits: 4_096,
	/** Ten minutes at 192 kHz: a generous gap, and still nowhere near a timeline. */
	maximumGapFrames: 115_200_000,
});

export interface MasteringSequenceEntryV23 {
	readonly id: string;
	/** The V11 region this entry delivers, by identity. */
	readonly annotationId: string;
	/**
	 * Null means the region's own name is the title, so renaming a region flows
	 * through to the delivery unless the operator deliberately overrode it.
	 */
	readonly title: string | null;
	/**
	 * Delivery metadata as open key/value pairs. Performer, ISRC, catalogue
	 * number and whatever a particular delivery specification asks for all live
	 * here rather than in a fixed field list, because a fixed list is wrong for
	 * the next specification by construction.
	 */
	readonly metadata: Readonly<Record<string, string>>;
	/**
	 * Silence before this entry. Gaps belong to the entry that follows them, so
	 * "the gap between two pieces" always has exactly one owner, and the first
	 * entry's gap is the lead-in.
	 */
	readonly gapBeforeFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
}

export interface MasteringSequenceV23 {
	readonly id: string;
	/** The timeline sequence whose regions this order refers to. */
	readonly sequenceId: string;
	readonly name: string;
	readonly entries: readonly MasteringSequenceEntryV23[];
	readonly opaqueExtensions: Readonly<Record<string, unknown>>;
}

/** A region as this module needs to see it: identity, extent, and its name. */
export interface MasteringSequenceRegionView {
	readonly id: string;
	readonly sequenceId: string;
	readonly name: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export type MasteringSequenceIssueCode =
	| 'mastering-sequence.region-missing'
	| 'mastering-sequence.region-not-a-region'
	| 'mastering-sequence.region-other-sequence'
	| 'mastering-sequence.fades-exceed-region'
	| 'mastering-sequence.order-diverges-from-timeline';

export interface MasteringSequenceIssue {
	readonly code: MasteringSequenceIssueCode;
	readonly severity: 'error' | 'info';
	readonly entryId: string | null;
	readonly annotationId: string | null;
	readonly message: string;
}

export interface MasteringSequenceValidation {
	/** False when any error-level issue is present. Deliveries refuse on this. */
	readonly valid: boolean;
	readonly issues: readonly MasteringSequenceIssue[];
}

export class MasteringSequenceValidationError extends Error {
	readonly issues: readonly MasteringSequenceIssue[];

	constructor(issues: readonly MasteringSequenceIssue[]) {
		super(issues[0]?.message ?? 'The mastering sequence is not valid.');
		this.name = 'MasteringSequenceValidationError';
		this.issues = issues;
	}
}

const MASTERING_SEQUENCE_FIELDS = Object.freeze([
	'id', 'sequenceId', 'name', 'entries', 'opaqueExtensions',
]);

const MASTERING_SEQUENCE_ENTRY_FIELDS = Object.freeze([
	'id', 'annotationId', 'title', 'metadata',
	'gapBeforeFrames', 'fadeInFrames', 'fadeOutFrames',
]);

const EXTENSION_VALIDATION_LIMITS = resolveAudioEditorProjectV9ValidationLimits();
const INVALID_CANONICAL_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * Refuse a field this build does not know.
 *
 * Every neighbouring domain is closed — the V23 root and the track records both
 * throw on an unrecognized field — and `opaqueExtensions` is the sanctioned
 * place for anything a future build wants to carry. Picking the known fields and
 * ignoring the rest meant a stored sequence carrying, say, a `renderSettings`
 * object — the second export plan the model exists to forbid — loaded without a
 * word and was written back with the field silently deleted.
 */
function assertNoUnknownFields(
	record: Readonly<Record<string, unknown>>,
	known: readonly string[],
	name: string,
): void {
	for (const key of Object.keys(record)) {
		if (!known.includes(key)) throw new TypeError(`${name} has an unsupported field: ${key}.`);
	}
}

/** Create one canonical persisted mastering sequence, or refuse the input. */
export function createMasteringSequenceV23(value: unknown): MasteringSequenceV23 {
	const record = plainRecord(value, 'A mastering sequence');
	assertNoUnknownFields(record, MASTERING_SEQUENCE_FIELDS, 'A mastering sequence');
	const entries = Array.isArray(record.entries) ? record.entries : null;
	if (!entries) throw new TypeError('A mastering sequence requires an entries array.');
	if (entries.length > MASTERING_SEQUENCE_LIMITS.maximumEntries) {
		throw new RangeError('A mastering sequence exceeds its maximum entry count.');
	}
	const seen = new Set<string>();
	const canonicalEntries = entries.map((entry, index) => {
		const created = createEntry(entry, `Mastering sequence entry ${index}`);
		if (seen.has(created.id)) {
			throw new RangeError(`Mastering sequence entry ${created.id} is listed more than once.`);
		}
		seen.add(created.id);
		return created;
	});
	return Object.freeze({
		id: canonicalString(record.id, 'A mastering sequence id', MASTERING_SEQUENCE_LIMITS.maximumIdCodeUnits, false),
		sequenceId: canonicalString(record.sequenceId, 'A mastering sequence sequenceId', MASTERING_SEQUENCE_LIMITS.maximumIdCodeUnits, false),
		name: canonicalString(record.name, 'A mastering sequence name', MASTERING_SEQUENCE_LIMITS.maximumTitleCodeUnits, true),
		entries: Object.freeze(canonicalEntries),
		opaqueExtensions: cloneExtensions(record.opaqueExtensions ?? {}, 'A mastering sequence opaqueExtensions'),
	});
}

/**
 * Check one sequence against the regions it refers to.
 *
 * Everything here is relational: it is the part that cannot be decided from the
 * document alone, which is exactly why it is separate from construction. A
 * sequence stays structurally valid while the world around it changes, and this
 * reports what changed instead of editing the sequence to match.
 */
export function validateMasteringSequenceV23(
	sequence: MasteringSequenceV23,
	regions: Iterable<MasteringSequenceRegionView>,
): MasteringSequenceValidation {
	const byId = new Map<string, MasteringSequenceRegionView>();
	for (const region of regions) byId.set(region.id, region);
	const issues: MasteringSequenceIssue[] = [];
	const resolvedStarts: Array<{ entryId: string; startFrame: number }> = [];

	for (const entry of sequence.entries) {
		const region = byId.get(entry.annotationId);
		if (!region) {
			issues.push(issue(
				'mastering-sequence.region-missing', 'error', entry,
				'The region this entry delivers no longer exists. The entry was kept; the sequence cannot be delivered until it is repaired.',
			));
			continue;
		}
		if (region.sequenceId !== sequence.sequenceId) {
			issues.push(issue(
				'mastering-sequence.region-other-sequence', 'error', entry,
				'The region this entry delivers belongs to a different timeline sequence.',
			));
			continue;
		}
		const durationFrames = region.endFrame - region.startFrame;
		if (entry.fadeInFrames + entry.fadeOutFrames > durationFrames) {
			issues.push(issue(
				'mastering-sequence.fades-exceed-region', 'error', entry,
				'The fades are longer than the region they are applied to.',
			));
		}
		resolvedStarts.push({ entryId: entry.id, startFrame: region.startFrame });
	}

	// A sequence owns its own order, so timeline order diverging from it is not
	// an error — but it is exactly the thing an operator wants told rather than
	// discovered, so it is reported and never acted on.
	for (let index = 1; index < resolvedStarts.length; index += 1) {
		if (resolvedStarts[index].startFrame >= resolvedStarts[index - 1].startFrame) continue;
		issues.push(Object.freeze({
			code: 'mastering-sequence.order-diverges-from-timeline' as const,
			severity: 'info' as const,
			entryId: resolvedStarts[index].entryId,
			annotationId: null,
			message: 'This entry starts earlier in the timeline than the one before it. The delivery order is unchanged.',
		}));
		break;
	}

	return Object.freeze({
		valid: !issues.some((entry) => entry.severity === 'error'),
		issues: Object.freeze(issues),
	});
}

/** Refuse a delivery whose sequence is not valid, with the issues attached. */
export function assertMasteringSequenceDeliverableV23(validation: MasteringSequenceValidation): void {
	if (validation.valid) return;
	throw new MasteringSequenceValidationError(
		validation.issues.filter((entry) => entry.severity === 'error'),
	);
}

/** The title a delivery uses: the entry's override, or the region's own name. */
export function masteringSequenceEntryTitle(
	entry: MasteringSequenceEntryV23,
	region: MasteringSequenceRegionView | null | undefined,
): string {
	return entry.title ?? region?.name ?? '';
}

function createEntry(value: unknown, name: string): MasteringSequenceEntryV23 {
	const record = plainRecord(value, name);
	assertNoUnknownFields(record, MASTERING_SEQUENCE_ENTRY_FIELDS, name);
	return Object.freeze({
		id: canonicalString(record.id, `${name} id`, MASTERING_SEQUENCE_LIMITS.maximumIdCodeUnits, false),
		annotationId: canonicalString(record.annotationId, `${name} annotationId`, MASTERING_SEQUENCE_LIMITS.maximumIdCodeUnits, false),
		title: record.title == null
			? null
			: canonicalString(record.title, `${name} title`, MASTERING_SEQUENCE_LIMITS.maximumTitleCodeUnits, true),
		metadata: createMetadata(record.metadata ?? {}, `${name} metadata`),
		gapBeforeFrames: boundedFrames(record.gapBeforeFrames ?? 0, `${name} gapBeforeFrames`),
		fadeInFrames: boundedFrames(record.fadeInFrames ?? 0, `${name} fadeInFrames`),
		fadeOutFrames: boundedFrames(record.fadeOutFrames ?? 0, `${name} fadeOutFrames`),
	});
}

function createMetadata(value: unknown, name: string): Readonly<Record<string, string>> {
	const record = plainRecord(value, name);
	const keys = Object.keys(record);
	if (keys.length > MASTERING_SEQUENCE_LIMITS.maximumMetadataEntries) {
		throw new RangeError(`${name} exceeds its maximum entry count.`);
	}
	const metadata: Record<string, string> = {};
	// Sorted so a sequence that round-trips through storage compares equal to
	// itself byte for byte, whatever order the keys were authored in.
	for (const key of keys.sort()) {
		canonicalString(key, `${name} key`, MASTERING_SEQUENCE_LIMITS.maximumMetadataKeyCodeUnits, false);
		metadata[key] = canonicalString(
			record[key], `${name}.${key}`, MASTERING_SEQUENCE_LIMITS.maximumMetadataValueCodeUnits, true,
		);
	}
	return Object.freeze(metadata);
}

function boundedFrames(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative integer frame count.`);
	}
	if (value > MASTERING_SEQUENCE_LIMITS.maximumGapFrames) {
		throw new RangeError(`${name} exceeds its maximum.`);
	}
	return value;
}

function issue(
	code: MasteringSequenceIssueCode,
	severity: 'error' | 'info',
	entry: MasteringSequenceEntryV23,
	message: string,
): MasteringSequenceIssue {
	return Object.freeze({ code, severity, entryId: entry.id, annotationId: entry.annotationId, message });
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function cloneExtensions(value: unknown, name: string): Readonly<Record<string, unknown>> {
	admitAudioEditorProjectV9ValidationStructure(value, EXTENSION_VALIDATION_LIMITS);
	const record = plainRecord(value, name);
	try {
		return Object.freeze(structuredClone(record)) as Readonly<Record<string, unknown>>;
	} catch {
		throw new TypeError(`${name} must be cloneable.`);
	}
}

function canonicalString(value: unknown, name: string, maximumLength: number, allowEmpty: boolean): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new TypeError(`${name} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
	}
	if (value !== value.trim()) throw new TypeError(`${name} must be a canonical string.`);
	if (value.length > maximumLength) throw new RangeError(`${name} length exceeds its maximum.`);
	if (INVALID_CANONICAL_TEXT.test(value)) {
		throw new TypeError(`${name} must be single-line and contain no control or formatting characters.`);
	}
	return value;
}
