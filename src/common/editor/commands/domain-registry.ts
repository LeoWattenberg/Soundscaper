/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	AudioEditorCommandType,
	EditorCommandHandler,
} from './protocol.ts';

export type DomainCommandHandlerRegistry<
	Types extends readonly AudioEditorCommandType[],
> = {
	readonly [Type in Types[number]]: EditorCommandHandler<Type>;
};

/** Validate the runtime shape as well as the compile-time mapped type. */
export function defineDomainCommandHandlerRegistry<
	const Types extends readonly AudioEditorCommandType[],
>(
	domainName: string,
	commandTypes: Types,
	handlers: DomainCommandHandlerRegistry<Types>,
): Readonly<DomainCommandHandlerRegistry<Types>> {
	if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
		throw new TypeError(`${domainName} command handlers must be an object.`);
	}
	const expected = new Set<string>(commandTypes);
	const actual = Object.keys(handlers);
	const candidates = handlers as unknown as Partial<Record<AudioEditorCommandType, unknown>>;
	const missing = commandTypes.filter((type) => typeof candidates[type] !== 'function');
	const unexpected = actual.filter((type) => !expected.has(type));
	if (missing.length || unexpected.length) {
		const details = [
			missing.length ? `missing ${missing.join(', ')}` : '',
			unexpected.length ? `unexpected ${unexpected.join(', ')}` : '',
		].filter(Boolean).join('; ');
		throw new TypeError(`${domainName} command registry is not exhaustive: ${details}.`);
	}
	return Object.freeze({ ...handlers });
}
