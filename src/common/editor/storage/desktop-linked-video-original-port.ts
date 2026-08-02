/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSnapshot,
} from './linked-video-original-resolver.ts';

export interface DesktopLinkedVideoOriginalChoice {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly file: Blob & Readonly<{ readonly name?: string }>;
}

interface DesktopLinkedVideoOriginalBridge {
	chooseLinkedVideoOriginal?(): PromiseLike<unknown> | unknown;
	loadLinkedVideoOriginal?(request: Readonly<{
		locatorId: string;
		expectedRevision: string | null;
	}>): PromiseLike<unknown> | unknown;
	releaseLinkedVideoOriginal?(locatorId: string): PromiseLike<unknown> | unknown;
}

interface DesktopLinkedVideoOriginalAccessOptions {
	readonly bridge: DesktopLinkedVideoOriginalBridge | null;
	readonly openReadDescriptor: (
		descriptor: unknown,
		request?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<Blob & Readonly<{ readonly name?: string }>>;
}

export interface DesktopLinkedVideoOriginalAccess {
	readonly available: boolean;
	readonly port: (LinkedVideoOriginalPort & Readonly<{
		release(locatorId: string): Promise<boolean>;
	}>) | null;
	choose(request?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<DesktopLinkedVideoOriginalChoice> | null>;
	release(locatorId: string): Promise<boolean>;
}

const LOCATOR_FIELDS = Object.freeze([
	'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified',
]);
const LOAD_FIELDS = Object.freeze(['locatorRevision', 'descriptor']);
const MATERIALIZED_VIDEO_MAXIMUM_BYTES = 512 * 1024 ** 2;

/** Adapts the frozen preload DTOs to the renderer's pathless storage port. */
export function createDesktopLinkedVideoOriginalAccess(
	options: DesktopLinkedVideoOriginalAccessOptions,
): Readonly<DesktopLinkedVideoOriginalAccess> {
	const bridge = options?.bridge;
	const available = typeof bridge?.chooseLinkedVideoOriginal === 'function'
		&& typeof bridge.loadLinkedVideoOriginal === 'function'
		&& typeof bridge.releaseLinkedVideoOriginal === 'function';
	const port: DesktopLinkedVideoOriginalAccess['port'] = available
		? Object.freeze({ load, release })
		: null;
	return Object.freeze({ available, port, choose, release });

	async function choose(
		request: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<DesktopLinkedVideoOriginalChoice> | null> {
		if (!available) return null;
		throwIfAborted(request.signal);
		const rawChoice = await bridge.chooseLinkedVideoOriginal?.();
		throwIfAborted(request.signal);
		if (rawChoice === null) return null;
		const choice = locatorValue(rawChoice);
		try {
			const loaded = await loadFile(choice.locatorId, choice.locatorRevision, request.signal);
			if (!loaded) throw new Error('The selected linked-video original is unavailable or changed.');
			if (loaded.locatorRevision !== choice.locatorRevision) {
				throw new Error('The selected linked-video original changed before materialization.');
			}
			return Object.freeze({ ...choice, file: loaded.file });
		} catch (error) {
			try {
				await release(choice.locatorId);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'The linked-video selection failed and its locator cleanup was incomplete.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async function load(
		locatorId: string,
		request: Readonly<{ expectedRevision: string | null; signal?: AbortSignal }>,
	): Promise<LinkedVideoOriginalSnapshot | null> {
		const loaded = await loadFile(locatorId, request?.expectedRevision, request?.signal);
		return loaded
			? Object.freeze({ blob: loaded.file, locatorRevision: loaded.locatorRevision })
			: null;
	}

	async function loadFile(
		locatorIdValue: unknown,
		expectedRevisionValue: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<{
		readonly file: Blob & Readonly<{ readonly name?: string }>;
		readonly locatorRevision: string;
	}> | null> {
		if (!available) return null;
		const locatorId = locatorToken(locatorIdValue, 'locator identifier');
		const expectedRevision = expectedRevisionValue === null
			? null
			: locatorToken(expectedRevisionValue, 'expected locator revision');
		throwIfAborted(signal);
		const raw = await bridge.loadLinkedVideoOriginal?.({ locatorId, expectedRevision });
		throwIfAborted(signal);
		if (raw === null) return null;
		const loaded = closedRecord(raw, LOAD_FIELDS, 'Linked-video load response');
		const locatorRevision = locatorToken(loaded.locatorRevision, 'locator revision');
		const file = await options.openReadDescriptor(loaded.descriptor, { signal });
		throwIfAborted(signal);
		return Object.freeze({ file, locatorRevision });
	}

	async function release(locatorIdValue: string): Promise<boolean> {
		if (!available) return false;
		const locatorId = locatorToken(locatorIdValue, 'locator identifier');
		return (await bridge.releaseLinkedVideoOriginal?.(locatorId)) === true;
	}
}

function locatorValue(value: unknown): Omit<DesktopLinkedVideoOriginalChoice, 'file'> {
	const candidate = closedRecord(value, LOCATOR_FIELDS, 'Linked-video locator choice');
	const name = String(candidate.name ?? '');
	if (!name || name !== name.trim() || name.length > 255 || name === '.' || name === '..'
		|| name.includes('/') || name.includes('\\') || /[\u0000-\u001f]/u.test(name)) {
		throw new TypeError('Linked-video locator choice has an invalid name.');
	}
	const size = candidate.size;
	if (!Number.isSafeInteger(size) || Number(size) < 1
		|| Number(size) > MATERIALIZED_VIDEO_MAXIMUM_BYTES) {
		throw new RangeError('Linked-video locator choice has an invalid size.');
	}
	const mimeType = String(candidate.mimeType ?? '');
	if (mimeType.length > 128 || !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mimeType)) {
		throw new TypeError('Linked-video locator choice has an invalid video MIME type.');
	}
	const lastModified = candidate.lastModified;
	if (!Number.isSafeInteger(lastModified) || Number(lastModified) < 0) {
		throw new RangeError('Linked-video locator choice has an invalid modification time.');
	}
	return Object.freeze({
		locatorId: locatorToken(candidate.locatorId, 'locator identifier'),
		locatorRevision: locatorToken(candidate.locatorRevision, 'locator revision'),
		name,
		size: Number(size),
		mimeType,
		lastModified: Number(lastModified),
	});
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function locatorToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Linked-video ${label} is invalid.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked-video access was cancelled.', 'AbortError');
	const error = new Error('Linked-video access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
