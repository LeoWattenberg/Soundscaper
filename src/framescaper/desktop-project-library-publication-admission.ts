/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const ADMISSION_FIELDS = [
	'publicationId', 'maximumChunkBytes', 'bodyCount', 'requiredBodyIndexes',
] as const;

export interface FramescaperDesktopPublicationAdmission {
	readonly publicationId: string;
	readonly maximumChunkBytes: typeof MAXIMUM_CHUNK_BYTES;
	readonly bodyCount: number;
	readonly requiredBodyIndexes: readonly number[];
}

export function createFramescaperDesktopPublicationId(): string {
	const bytes = new Uint8Array(24);
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('Web Crypto is required for Framescaper publication identities.');
	}
	globalThis.crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateFramescaperDesktopPublicationAdmission(
	value: unknown,
	publicationId: string,
	bodyCount: number,
): Readonly<FramescaperDesktopPublicationAdmission> {
	const admission = closedRecord(value, ADMISSION_FIELDS, 'publication admission');
	if (admission.publicationId !== publicationId
		|| admission.maximumChunkBytes !== MAXIMUM_CHUNK_BYTES
		|| admission.bodyCount !== bodyCount) {
		throw new Error('Framescaper publication admission changed.');
	}
	if (!Array.isArray(admission.requiredBodyIndexes)
		|| Reflect.ownKeys(admission.requiredBodyIndexes).length !== admission.requiredBodyIndexes.length + 1
		|| admission.requiredBodyIndexes.length > bodyCount) {
		throw new TypeError('Framescaper required publication bodies must be a bounded dense array.');
	}
	const requiredBodyIndexes = admission.requiredBodyIndexes.map((value, position, values) => {
		if (!Number.isSafeInteger(value) || value < 0 || value >= bodyCount
			|| position > 0 && value <= values[position - 1]) {
			throw new RangeError('Framescaper required publication body indexes changed.');
		}
		return value;
	});
	return Object.freeze({
		publicationId,
		maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
		bodyCount,
		requiredBodyIndexes: Object.freeze(requiredBodyIndexes),
	});
}

export function assertFramescaperDesktopPublicationBodyInventory(
	admitted: readonly Readonly<{ descriptor: unknown }>[],
	prepared: readonly Readonly<{ descriptor: unknown }>[],
): void {
	if (JSON.stringify(prepared.map(({ descriptor }) => descriptor))
		!== JSON.stringify(admitted.map(({ descriptor }) => descriptor))) {
		throw new Error('Framescaper publication body inventory changed after admission.');
	}
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`Framescaper ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`Framescaper ${label} has unsupported fields.`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper ${label}.${field} must be an own data property.`);
		}
		result[field] = descriptor.value;
	}
	return result;
}
