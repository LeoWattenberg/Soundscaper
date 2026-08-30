/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;

export const SOUNDSCAPER_PERSISTENT_DELIVERY_SAVE_TARGET_KIND =
	'soundscaper-persistent-delivery-save-target-v1' as const;

export interface SoundscaperPersistentDeliverySaveTargetV1 {
	readonly kind: typeof SOUNDSCAPER_PERSISTENT_DELIVERY_SAVE_TARGET_KIND;
	readonly claimId: string;
}

export interface SoundscaperPersistentDeliveryWriteCapability {
	beginWrite(value: unknown): Awaitable<unknown>;
	writeChunk(value: unknown): Awaitable<unknown>;
	patchFinalPrefix(value: unknown): Awaitable<unknown>;
	finishWrite(writeId: string): Awaitable<unknown>;
	abortWrite(writeId: string): Awaitable<unknown>;
}

const PRIVATE_WRITERS = new WeakMap<object, SoundscaperPersistentDeliveryWriteCapability>();

/** Opaque renderer target; it is a claim token, never a path or save capability. */
export function createSoundscaperPersistentDeliverySaveTarget(
	claimId: string,
	writer: SoundscaperPersistentDeliveryWriteCapability,
): SoundscaperPersistentDeliverySaveTargetV1 {
	assertWriter(writer);
	const target = Object.freeze({
		kind: SOUNDSCAPER_PERSISTENT_DELIVERY_SAVE_TARGET_KIND,
		claimId: opaqueId(claimId, 'claim'),
	});
	PRIVATE_WRITERS.set(target, writer);
	return target;
}

/**
 * Adapt the private persistent stream to the ordinary prepared-save contract.
 * The ordinary export code remains unaware of queueing and receives the same
 * stream shape it uses for a direct Save As delivery.
 */
export function bindSoundscaperPersistentDeliverySave(
	targetValue: unknown,
	fileNameValue: unknown,
): Readonly<{ bridge: object; target: Readonly<{ id: string; name: string }> }> | null {
	if (!isPersistentTarget(targetValue)) return null;
	const target = validateTarget(targetValue);
	const writer = PRIVATE_WRITERS.get(targetValue as object);
	if (!writer) throw new Error('The Soundscaper persistent delivery claim capability is unavailable.');
	const fileName = leaf(fileNameValue);
	const stream = Object.freeze({
		beginWrite: (request: Readonly<Record<string, unknown>>) => {
			if (request.targetId !== target.claimId) throw new Error('Persistent delivery save target changed.');
			return writer.beginWrite({
				fileName,
				...(request.size === undefined ? {} : { size: request.size }),
				...(request.maximumSize === undefined ? {} : { maximumSize: request.maximumSize }),
				...(request.finalPrefixByteLength === undefined ? {}
					: { finalPrefixByteLength: request.finalPrefixByteLength }),
			});
		},
		writeChunk: (request: unknown) => writer.writeChunk(request),
		patchFinalPrefix: (request: unknown) => writer.patchFinalPrefix(request),
		finishWrite: (writeId: unknown) => writer.finishWrite(opaqueId(writeId, 'write')),
		abortWrite: (writeId: unknown) => writer.abortWrite(opaqueId(writeId, 'write')),
	});
	return Object.freeze({ bridge: stream, target: Object.freeze({ id: target.claimId, name: fileName }) });
}

function isPersistentTarget(value: unknown): value is SoundscaperPersistentDeliverySaveTargetV1 {
	return Boolean(value && typeof value === 'object'
		&& (value as Readonly<{ kind?: unknown }>).kind === SOUNDSCAPER_PERSISTENT_DELIVERY_SAVE_TARGET_KIND);
}

function validateTarget(value: unknown): SoundscaperPersistentDeliverySaveTargetV1 {
	const keys = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.ownKeys(value) : [];
	if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('claimId')) {
		throw new TypeError('A closed Soundscaper persistent delivery save target is required.');
	}
	opaqueId((value as Readonly<{ claimId?: unknown }>).claimId, 'claim');
	return value as SoundscaperPersistentDeliverySaveTargetV1;
}

function assertWriter(value: unknown): asserts value is SoundscaperPersistentDeliveryWriteCapability {
	if (!value || typeof value !== 'object'
		|| !['beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']
			.every((method) => typeof (value as Record<string, unknown>)[method] === 'function')) {
		throw new TypeError('A private persistent delivery write capability is required.');
	}
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`The Soundscaper persistent delivery ${label} id is invalid.`);
	}
	return value;
}

function leaf(value: unknown): string {
	if (typeof value !== 'string' || !value || value === '.' || value === '..'
		|| /[\0-\x1f/\\]/u.test(value) || new TextEncoder().encode(value).byteLength > 220) {
		throw new TypeError('The Soundscaper persistent delivery file name is invalid.');
	}
	return value;
}
