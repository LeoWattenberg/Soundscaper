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

export function freezePresentationMessage(message: LocalizedPresentationMessage): LocalizedPresentationMessage {
	return Object.freeze({ ...message,
		...(message.parameters ? { parameters: Object.freeze(Object.fromEntries(
			Object.entries(message.parameters).map(([key, value]) => [key,
				typeof value === 'object' ? freezePresentationMessage(value) : value]),
		)) } : {}),
		...(message.append ? { append: Object.freeze(message.append.map(part => (
			typeof part === 'object' ? freezePresentationMessage(part) : part
		))) } : {}),
	});
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
	const candidate: unknown = Reflect.get(copy, message.key);
	const template = typeof candidate === 'string' ? candidate : message.fallback ?? message.key;
	const formatted = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder: string, name: string) => {
		const value = message.parameters?.[name];
		if (value === undefined) return placeholder;
		return typeof value === 'object' ? formatPresentationMessage(copy, value) : String(value);
	});
	const append = message.append?.map(part => typeof part === 'string' ? part : formatPresentationMessage(copy, part)).join('') ?? '';
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
	const message: LocalizedPresentationMessage = { key, ...(parameters ? { parameters } : {}), ...decoration };
	publish(formatPresentationMessage(copy, message), state as State, message);
}

/** Alias ports can publish their formatted text with a canonical identity. */
export function publishLocalizedStatus<State extends string | undefined>(
	publish: (message: string, state: State, localization?: LocalizedPresentationMessage) => void,
	text: string,
	localization: LocalizedPresentationMessage,
	state?: State,
): void {
	publish(text, state as State, localization);
}
