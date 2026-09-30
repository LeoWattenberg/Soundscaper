/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LocalizedPresentationMessage {
	readonly key: string;
	readonly parameters?: Readonly<Record<string, string | number | LocalizedPresentationMessage>>;
	readonly prefix?: string;
	readonly suffix?: string;
	readonly append?: readonly (string | LocalizedPresentationMessage)[];
	readonly fallback?: string;
}

export type LocalizedStatusPublisher = (
	message: string, state?: string, localization?: LocalizedPresentationMessage,
) => void;

const localizedErrors = new WeakMap<Error, LocalizedPresentationMessage>();

const MAXIMUM_PRESENTATION_MESSAGE_DEPTH = 32;

export function freezePresentationMessage(message: LocalizedPresentationMessage): LocalizedPresentationMessage {
	return freezePresentationMessageAt(message, new WeakSet<object>(), 0);
}

/** Keep application-owned error wording editable without changing Error behavior. */
export function createLocalizedError<Constructor extends new (message?: string) => Error>(
	constructor: Constructor, copy: object, key: string, parameters?: LocalizedPresentationMessage['parameters'],
	decoration?: Pick<LocalizedPresentationMessage, 'fallback'>,
): InstanceType<Constructor> {
	const message = freezePresentationMessage({ key, ...(parameters ? { parameters } : {}), ...decoration });
	const error = new constructor(formatPresentationMessage(copy, message)) as InstanceType<Constructor>;
	localizedErrors.set(error, message);
	return error;
}

export function localizedErrorMessage(error: unknown): LocalizedPresentationMessage | undefined {
	if (!(error instanceof Error) || error.cause !== undefined || error instanceof AggregateError) return undefined;
	return localizedErrors.get(error);
}

/** Message identities remain separate from their public, formatted strings. */
export function formatPresentationMessage(copy: object, message: LocalizedPresentationMessage): string {
	return formatFrozenPresentationMessage(copy, freezePresentationMessage(message));
}

function formatFrozenPresentationMessage(copy: object, message: LocalizedPresentationMessage): string {
	const candidate: unknown = copy !== null && typeof copy === 'object' && Object.hasOwn(copy, message.key)
		? Reflect.get(copy, message.key) : undefined;
	const template = typeof candidate === 'string' ? candidate : message.fallback ?? message.key;
	const formatted = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder: string, name: string) => {
		const value = message.parameters?.[name];
		if (value === undefined) return placeholder;
		return typeof value === 'object' ? formatFrozenPresentationMessage(copy, value) : String(value);
	});
	const append = message.append?.map(part => typeof part === 'string'
		? part : formatFrozenPresentationMessage(copy, part)).join('') ?? '';
	return `${message.prefix ?? ''}${formatted}${message.suffix ?? ''}${append}`;
}

/** Single-argument test/host callbacks still receive the same formatted text. */
export function setLocalizedStatus<Copy extends object, State extends string | undefined>(
	publish: (message: string, state: State, localization?: LocalizedPresentationMessage) => void,
	copy: Copy,
	key: string,
	parameters?: LocalizedPresentationMessage['parameters'],
	state?: State,
	decoration?: Pick<LocalizedPresentationMessage, 'prefix' | 'suffix' | 'append' | 'fallback'>,
): void {
	const message = freezePresentationMessage({ key, ...(parameters ? { parameters } : {}), ...decoration });
	publish(formatFrozenPresentationMessage(copy, message), state as State, message);
}

/** Alias ports can publish their formatted text with a canonical identity. */
export function publishLocalizedStatus<State extends string | undefined>(
	publish: (message: string, state: State, localization?: LocalizedPresentationMessage) => void,
	text: string,
	localization: LocalizedPresentationMessage,
	state?: State,
): void {
	publish(text, state as State, freezePresentationMessage(localization));
}

function freezePresentationMessageAt(
	message: LocalizedPresentationMessage,
	ancestors: WeakSet<object>,
	depth: number,
): LocalizedPresentationMessage {
	if (!isPlainRecord(message) || typeof message.key !== 'string' || !message.key) {
		throw new TypeError('A localized presentation message needs a non-empty string key.');
	}
	if (depth > MAXIMUM_PRESENTATION_MESSAGE_DEPTH) {
		throw new RangeError(`A localized presentation message may be nested at most ${MAXIMUM_PRESENTATION_MESSAGE_DEPTH} levels.`);
	}
	if (ancestors.has(message)) throw new TypeError('A localized presentation message must not contain a cycle.');
	ancestors.add(message);
	try {
		const clone: LocalizedPresentationMessage = {
			key: message.key,
			...copyOptionalText(message, 'prefix'),
			...copyOptionalText(message, 'suffix'),
			...copyOptionalText(message, 'fallback'),
		};
		if (message.parameters !== undefined) {
			if (!isPlainRecord(message.parameters)) {
				throw new TypeError('Localized presentation message parameters must be a record.');
			}
			const parameters: [string, string | number | LocalizedPresentationMessage][] = [];
			for (const [key, value] of Object.entries(message.parameters)) {
				if (typeof value === 'string' || typeof value === 'number') parameters.push([key, value]);
				else if (isPlainRecord(value)) {
					parameters.push([key, freezePresentationMessageAt(
						value as unknown as LocalizedPresentationMessage, ancestors, depth + 1,
					)]);
				} else throw new TypeError(`Localized presentation parameter ${key} is invalid.`);
			}
			(clone as { parameters?: LocalizedPresentationMessage['parameters'] }).parameters =
				Object.freeze(Object.fromEntries(parameters));
		}
		if (message.append !== undefined) {
			if (!Array.isArray(message.append)) {
				throw new TypeError('Localized presentation message append must be an array.');
			}
			(clone as { append?: LocalizedPresentationMessage['append'] }).append = Object.freeze(
				message.append.map((part, index) => {
					if (typeof part === 'string') return part;
					if (isPlainRecord(part)) {
						return freezePresentationMessageAt(
							part as unknown as LocalizedPresentationMessage, ancestors, depth + 1,
						);
					}
					throw new TypeError(`Localized presentation append part ${String(index)} is invalid.`);
				}),
			);
		}
		return Object.freeze(clone);
	} finally {
		ancestors.delete(message);
	}
}

function copyOptionalText(
	message: LocalizedPresentationMessage,
	field: 'prefix' | 'suffix' | 'fallback',
): Partial<Pick<LocalizedPresentationMessage, 'prefix' | 'suffix' | 'fallback'>> {
	const value = message[field];
	if (value === undefined) return {};
	if (typeof value !== 'string') throw new TypeError(`Localized presentation message ${field} must be a string.`);
	return { [field]: value };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
