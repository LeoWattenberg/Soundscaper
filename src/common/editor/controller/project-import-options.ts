/* SPDX-License-Identifier: AGPL-3.0-only */

type ImportOptionsRecord = Record<string, unknown>;

export interface LinkedVideoImportLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

const OPAQUE_LINKED_VIDEO_LOCATOR_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;

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
		...normalizeLinkedVideoImportLocator(candidate),
	}, timelineStartExplicit);
}

export async function normalizeProjectImportOptionsForUse(
	value: unknown,
	timelineFramesFinite: string,
	releaseLocator: (reference: LinkedVideoImportLocatorReference) => PromiseLike<unknown> | unknown,
): Promise<Readonly<ImportOptionsRecord>> {
	try {
		if (isNormalizedProjectImportOptions(value)) {
			normalizeLinkedVideoImportLocator(optionRecord(value));
			return value;
		}
		return normalizeProjectImportOptions(value, timelineFramesFinite);
	} catch (error) {
		const locatorReference = linkedVideoLocatorReferenceFromImportOptions(value);
		if (locatorReference) {
			try {
				await releaseLocator(locatorReference);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Import option validation and linked-video locator cleanup both failed.',
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
	return Object.freeze(value);
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

function normalizeLinkedVideoImportLocator(candidate: ImportOptionsRecord): ImportOptionsRecord {
	const locatorId = candidate.linkedVideoLocatorId;
	const locatorRevision = candidate.linkedVideoLocatorRevision;
	if (locatorId == null && locatorRevision == null) return {};
	if (!opaqueLocatorToken(locatorId) || !opaqueLocatorToken(locatorRevision)) {
		throw new TypeError('An opaque linked video locator and revision are required together.');
	}
	return { linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: locatorRevision };
}

export function linkedVideoLocatorReferenceFromImportOptions(
	value: unknown,
): Readonly<LinkedVideoImportLocatorReference> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const locatorId = Object.getOwnPropertyDescriptor(value, 'linkedVideoLocatorId');
	const locatorRevision = Object.getOwnPropertyDescriptor(value, 'linkedVideoLocatorRevision');
	if (!locatorId?.enumerable || !Object.hasOwn(locatorId, 'value')
		|| !locatorRevision?.enumerable || !Object.hasOwn(locatorRevision, 'value')
		|| !opaqueLocatorToken(locatorId.value) || !opaqueLocatorToken(locatorRevision.value)) return null;
	return Object.freeze({
		locatorId: locatorId.value,
		locatorRevision: locatorRevision.value,
	});
}

function opaqueLocatorToken(value: unknown): value is string {
	return typeof value === 'string' && OPAQUE_LINKED_VIDEO_LOCATOR_PATTERN.test(value);
}

function isNormalizedProjectImportOptions(value: unknown): value is Readonly<ImportOptionsRecord> {
	return Boolean(value && typeof value === 'object' && Object.hasOwn(value, 'timelineStartExplicit'));
}

function optionRecord(value: unknown): ImportOptionsRecord {
	return value && typeof value === 'object' ? value as ImportOptionsRecord : {};
}
