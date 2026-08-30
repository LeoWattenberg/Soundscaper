/* SPDX-License-Identifier: AGPL-3.0-only */

type ImportOptionsRecord = Record<string, unknown>;

export interface LinkedVideoImportLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface LinkedAudioImportLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface LinkedOriginalImportLocatorReference {
	readonly kind: 'audio' | 'video';
	readonly locatorId: string;
	readonly locatorRevision: string;
}

const OPAQUE_LINKED_ORIGINAL_LOCATOR_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;
const NORMALIZED_PROJECT_IMPORT_OPTIONS = new WeakSet<object>();

export function normalizeProjectImportOptions(
	value: unknown,
	timelineFramesFinite: string,
): Readonly<ImportOptionsRecord> {
	const candidate = optionRecord(value);
	const requestedDestination = candidate.destination ?? 'auto';
	if (typeof requestedDestination !== 'string'
		|| !['auto', 'timeline', 'project-bin'].includes(requestedDestination)) {
		throw new RangeError(`Unsupported audio import destination: ${String(requestedDestination)}.`);
	}
	const destination = requestedDestination === 'auto'
		? candidate.projectBinVisible ? 'project-bin' : 'timeline'
		: requestedDestination;
	const timelineStartExplicit = Object.hasOwn(candidate, 'timelineStartExplicit')
		? Boolean(candidate.timelineStartExplicit)
		: Object.hasOwn(candidate, 'timelineStartFrame');
	return freezeProjectImportOptions({
		destination,
		trackId: candidate.trackId == null ? null : String(candidate.trackId),
		timelineStartFrame: normalizeProjectImportTimelineStartFrame(
			candidate.timelineStartFrame ?? 0,
			timelineFramesFinite,
		),
		...(Number.isSafeInteger(candidate.trackIndex) ? { trackIndex: candidate.trackIndex } : {}),
		...normalizeLinkedOriginalImportLocator(candidate),
	}, timelineStartExplicit);
}

export async function normalizeProjectImportOptionsForUse(
	value: unknown,
	timelineFramesFinite: string,
	releaseLocator: (reference: LinkedOriginalImportLocatorReference) => PromiseLike<unknown> | unknown,
): Promise<Readonly<ImportOptionsRecord>> {
	try {
		if (isNormalizedProjectImportOptions(value)) {
			normalizeLinkedOriginalImportLocator(optionRecord(value));
			return value;
		}
		return normalizeProjectImportOptions(value, timelineFramesFinite);
	} catch (error) {
		const locatorReferences = linkedOriginalLocatorReferencesFromImportOptions(value);
		if (locatorReferences.length) {
			const cleanupErrors: unknown[] = [];
			try {
				for (const reference of locatorReferences) {
					try {
						await releaseLocator(reference);
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
				}
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Import option validation and linked-original locator cleanup both failed.',
					{ cause: error },
				);
			}
		}
		throw error;
	}
}

export function freezeProjectImportOptions(
	value: ImportOptionsRecord,
	timelineStartExplicit: boolean,
): Readonly<ImportOptionsRecord> {
	Object.defineProperty(value, 'timelineStartExplicit', {
		configurable: false,
		enumerable: false,
		value: timelineStartExplicit,
		writable: false,
	});
	const normalized = Object.freeze(value);
	NORMALIZED_PROJECT_IMPORT_OPTIONS.add(normalized);
	return normalized;
}

export function normalizeProjectImportTimelineStartFrame(
	value: unknown,
	timelineFramesFinite: string,
): number {
	const frame = Number(value);
	if (!Number.isFinite(frame)) throw new TypeError(timelineFramesFinite);
	const rounded = Math.max(0, Math.round(frame));
	if (!Number.isSafeInteger(rounded)) throw new RangeError(timelineFramesFinite);
	return rounded;
}

function normalizeLinkedOriginalImportLocator(candidate: ImportOptionsRecord): ImportOptionsRecord {
	const audio = normalizeLinkedImportLocator(candidate, 'audio');
	const video = normalizeLinkedImportLocator(candidate, 'video');
	if (audio && video) {
		throw new TypeError('Import options can carry only one linked original locator.');
	}
	return audio ?? video ?? {};
}

function normalizeLinkedImportLocator(
	candidate: ImportOptionsRecord,
	kind: 'audio' | 'video',
): ImportOptionsRecord | null {
	const prefix = kind === 'audio' ? 'linkedAudio' : 'linkedVideo';
	const locatorField = `${prefix}LocatorId`;
	const revisionField = `${prefix}LocatorRevision`;
	const locatorId = candidate[locatorField];
	const locatorRevision = candidate[revisionField];
	if (locatorId == null && locatorRevision == null) return null;
	if (!opaqueLocatorToken(locatorId) || !opaqueLocatorToken(locatorRevision)) {
		throw new TypeError(`An opaque linked ${kind} locator and revision are required together.`);
	}
	return { [locatorField]: locatorId, [revisionField]: locatorRevision };
}

export function linkedOriginalLocatorReferenceFromImportOptions(
	value: unknown,
): Readonly<LinkedOriginalImportLocatorReference> | null {
	const references = linkedOriginalLocatorReferencesFromImportOptions(value);
	return references.length === 1 ? references[0] ?? null : null;
}

function linkedOriginalLocatorReferencesFromImportOptions(
	value: unknown,
): readonly Readonly<LinkedOriginalImportLocatorReference>[] {
	return [
		linkedLocatorReferenceFromImportOptions(value, 'audio'),
		linkedLocatorReferenceFromImportOptions(value, 'video'),
	].filter((reference): reference is Readonly<LinkedOriginalImportLocatorReference> => reference !== null);
}

export function linkedAudioLocatorReferenceFromImportOptions(
	value: unknown,
): Readonly<LinkedAudioImportLocatorReference> | null {
	const reference = linkedLocatorReferenceFromImportOptions(value, 'audio');
	return reference ? withoutKind(reference) : null;
}

export function linkedVideoLocatorReferenceFromImportOptions(
	value: unknown,
): Readonly<LinkedVideoImportLocatorReference> | null {
	const reference = linkedLocatorReferenceFromImportOptions(value, 'video');
	return reference ? withoutKind(reference) : null;
}

function linkedLocatorReferenceFromImportOptions(
	value: unknown,
	kind: 'audio' | 'video',
): Readonly<LinkedOriginalImportLocatorReference> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prefix = kind === 'audio' ? 'linkedAudio' : 'linkedVideo';
	const locatorId = Object.getOwnPropertyDescriptor(value, `${prefix}LocatorId`);
	const locatorRevision = Object.getOwnPropertyDescriptor(value, `${prefix}LocatorRevision`);
	if (!locatorId?.enumerable || !Object.hasOwn(locatorId, 'value')
		|| !locatorRevision?.enumerable || !Object.hasOwn(locatorRevision, 'value')
		|| !opaqueLocatorToken(locatorId.value) || !opaqueLocatorToken(locatorRevision.value)) return null;
	return Object.freeze({
		kind,
		locatorId: locatorId.value,
		locatorRevision: locatorRevision.value,
	});
}

function withoutKind(
	reference: LinkedOriginalImportLocatorReference,
): Readonly<LinkedVideoImportLocatorReference> {
	return Object.freeze({
		locatorId: reference.locatorId,
		locatorRevision: reference.locatorRevision,
	});
}

function opaqueLocatorToken(value: unknown): value is string {
	return typeof value === 'string' && OPAQUE_LINKED_ORIGINAL_LOCATOR_PATTERN.test(value);
}

function isNormalizedProjectImportOptions(value: unknown): value is Readonly<ImportOptionsRecord> {
	return Boolean(value && typeof value === 'object' && NORMALIZED_PROJECT_IMPORT_OPTIONS.has(value));
}

function optionRecord(value: unknown): ImportOptionsRecord {
	return value && typeof value === 'object' ? value as ImportOptionsRecord : {};
}
