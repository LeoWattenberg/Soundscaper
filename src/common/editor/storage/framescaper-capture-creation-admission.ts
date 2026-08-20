/* SPDX-License-Identifier: AGPL-3.0-only */

const CREATION_KEY_PREFIX = 'framescaper-capture-session-creation-v1:';
const CREATION_ADMISSION_KEY = 'framescaper-capture-session-creation-admission-v1';
const MAXIMUM_CAPTURE_CREATIONS = 4_096;
const MAXIMUM_CAS_ATTEMPTS = 32;

export interface CaptureCreationAdmissionIdentity {
	readonly projectId: string;
	readonly sessionId: string;
}

interface CaptureCreationAdmissionInventory {
	readonly version: 1;
	readonly entries: readonly CaptureCreationAdmissionIdentity[];
}

export interface CaptureCreationAdmissionPort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsentAndUpdate?(
		key: string,
		value: unknown,
		inventoryKey: string,
		expectedInventory: unknown | undefined,
		nextInventory: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): PromiseLike<boolean> | boolean;
}

/** A compact CAS inventory makes admission and its discoverable journal one atomic write. */
export class FramescaperCaptureCreationAdmissionRepository {
	readonly #values: CaptureCreationAdmissionPort;

	constructor(values: CaptureCreationAdmissionPort) {
		this.#values = values;
	}

	async reserve(identityValue: CaptureCreationAdmissionIdentity, journal: unknown): Promise<void> {
		const identity = normalizeIdentity(identityValue);
		const journalKey = framescaperCaptureCreationJournalKey(identity.projectId, identity.sessionId);
		const create = this.#values.putIfAbsentAndUpdate;
		if (typeof create !== 'function') {
			throw new TypeError('Framescaper capture creation admission requires an atomic inventory write.');
		}
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(CREATION_ADMISSION_KEY);
			const inventory = value == null ? emptyInventory() : normalizeInventory(value);
			let entries = inventory.entries;
			const existing = entries.find((entry) => sameIdentity(entry, identity));
			if (existing) {
				const stored = await this.#values.get(journalKey);
				if (stored != null) {
					if (sameValue(stored, journal)) return;
					throw new Error(`Framescaper capture creation ${identity.sessionId} already exists.`);
				}
				entries = entries.filter((entry) => entry !== existing);
			}
			if (entries.length >= MAXIMUM_CAPTURE_CREATIONS) {
				entries = await this.#retainDiscoverable(entries);
			}
			if (entries.length >= MAXIMUM_CAPTURE_CREATIONS) {
				throw new RangeError('Framescaper capture creation inventory reached its global admission bound.');
			}
			const next = freezeInventory([...entries, identity]);
			try {
				if (await create.call(
					this.#values, journalKey, journal, CREATION_ADMISSION_KEY, value ?? undefined, next,
				)) return;
			} catch (error) {
				if (await this.#isReserved(identity, journal)) return;
				throw error;
			}
		}
		throw new Error('Framescaper capture creation admission exceeded its bounded CAS retry limit.');
	}

	async assertAdmitted(identities: readonly CaptureCreationAdmissionIdentity[]): Promise<void> {
		const value = await this.#values.get(CREATION_ADMISSION_KEY);
		const inventory = value == null ? emptyInventory() : normalizeInventory(value);
		for (const identityValue of identities) {
			const identity = normalizeIdentity(identityValue);
			if (!inventory.entries.some((entry) => sameIdentity(entry, identity))) {
				throw new Error('Framescaper capture creation journal is outside its admission inventory.');
			}
		}
	}

	async release(identityValue: CaptureCreationAdmissionIdentity): Promise<void> {
		const identity = normalizeIdentity(identityValue);
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(CREATION_ADMISSION_KEY);
			if (value == null) return;
			const inventory = normalizeInventory(value);
			const existing = inventory.entries.find((entry) => sameIdentity(entry, identity));
			if (!existing) return;
			const next = freezeInventory(inventory.entries.filter((entry) => entry !== existing));
			try {
				if (await this.#values.replaceIfCurrent(CREATION_ADMISSION_KEY, value, next)) return;
			} catch (error) {
				const current = await this.#values.get(CREATION_ADMISSION_KEY);
				if (current == null || !normalizeInventory(current).entries.some(
					(entry) => sameIdentity(entry, identity),
				)) return;
				throw error;
			}
		}
		throw new Error('Framescaper capture creation admission release exceeded its bounded CAS retry limit.');
	}

	async #isReserved(identity: CaptureCreationAdmissionIdentity, journal: unknown): Promise<boolean> {
		const [stored, inventoryValue] = await Promise.all([
			this.#values.get(framescaperCaptureCreationJournalKey(identity.projectId, identity.sessionId)),
			this.#values.get(CREATION_ADMISSION_KEY),
		]);
		return stored != null && sameValue(stored, journal) && inventoryValue != null
			&& normalizeInventory(inventoryValue).entries.some((entry) => sameIdentity(entry, identity));
	}

	async #retainDiscoverable(
		entries: readonly CaptureCreationAdmissionIdentity[],
	): Promise<readonly CaptureCreationAdmissionIdentity[]> {
		const retained: CaptureCreationAdmissionIdentity[] = [];
		for (const entry of entries) {
			if (await this.#values.get(
				framescaperCaptureCreationJournalKey(entry.projectId, entry.sessionId),
			) != null) retained.push(entry);
		}
		return Object.freeze(retained);
	}
}

export function framescaperCaptureCreationJournalKey(projectId: string, sessionId: string): string {
	return `${framescaperCaptureCreationProjectPrefix(projectId)}${encodeURIComponent(sessionId)}`;
}

export function framescaperCaptureCreationProjectPrefix(projectId: string): string {
	return `${CREATION_KEY_PREFIX}${encodeURIComponent(projectId)}:`;
}

export function framescaperCaptureCreationGlobalPrefix(): string {
	return CREATION_KEY_PREFIX;
}

function normalizeInventory(value: unknown): CaptureCreationAdmissionInventory {
	const record = closedRecord(value, ['version', 'entries'], 'Framescaper capture creation admission inventory');
	const entryValues = closedArray(record.entries, 'Framescaper capture creation admission entries');
	if (record.version !== 1 || entryValues.length > MAXIMUM_CAPTURE_CREATIONS) {
		throw new Error('Framescaper capture creation admission inventory is invalid.');
	}
	const entries = entryValues.map((value) => normalizeIdentity(value as CaptureCreationAdmissionIdentity));
	if (new Set(entries.map((entry) => `${entry.projectId}\u0000${entry.sessionId}`)).size !== entries.length) {
		throw new Error('Framescaper capture creation admission inventory contains duplicate ownership.');
	}
	return freezeInventory(entries);
}

function normalizeIdentity(value: CaptureCreationAdmissionIdentity): CaptureCreationAdmissionIdentity {
	const record = closedRecord(value, ['projectId', 'sessionId'], 'Framescaper capture creation admission');
	return Object.freeze({
		projectId: stableId(record.projectId, 'Framescaper capture creation projectId'),
		sessionId: stableId(record.sessionId, 'Framescaper capture creation sessionId'),
	});
}

function emptyInventory(): CaptureCreationAdmissionInventory {
	return freezeInventory([]);
}

function freezeInventory(entries: readonly CaptureCreationAdmissionIdentity[]): CaptureCreationAdmissionInventory {
	return Object.freeze({
		version: 1,
		entries: Object.freeze([...entries].sort((left, right) => (
			left.projectId.localeCompare(right.projectId) || left.sessionId.localeCompare(right.sessionId)
		))),
	});
}

function sameIdentity(left: CaptureCreationAdmissionIdentity, right: CaptureCreationAdmissionIdentity): boolean {
	return left.projectId === right.projectId && left.sessionId === right.sessionId;
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function closedRecord(value: unknown, keys: readonly string[], name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== keys.length) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !keys.includes(key) || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} has an invalid closed shape.`);
		}
		record[key] = descriptor.value;
	}
	if (keys.some((key) => !Object.hasOwn(record, key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	return Object.freeze(record);
}

function closedArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a closed data array.`);
	}
	const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
	if (!Number.isSafeInteger(length) || Number(length) < 0
		|| Reflect.ownKeys(value).length !== Number(length) + 1) {
		throw new TypeError(`${name} must be a dense closed data array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
