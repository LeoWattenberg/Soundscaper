/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValuePrefixRecord } from './key-value-repository.ts';

export interface AssistanceDerivativeKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	putIfAbsentAndUpdate?(
		key: string,
		value: unknown,
		inventoryKey: string,
		expectedInventory: unknown | undefined,
		nextInventory: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrent?(
		key: string,
		expected: unknown,
		replacement: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrentWhenCurrent?(
		fenceKey: string,
		expectedFence: unknown,
		key: string,
		expected: unknown,
		replacement: unknown,
	): PromiseLike<boolean> | boolean;
	delete(key: string): PromiseLike<unknown> | unknown;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	deleteIfCurrentAndUpdate?(
		key: string,
		expected: unknown,
		inventoryKey: string,
		expectedInventory: unknown,
		nextInventory: unknown,
	): PromiseLike<boolean> | boolean;
	deleteKeysIfCurrentAndUpdate?(
		keys: readonly string[],
		inventoryKey: string,
		expectedInventory: unknown,
		nextInventory: unknown,
	): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<KeyValuePrefixRecord>[]>
		| readonly Readonly<KeyValuePrefixRecord>[];
}

export interface AtomicAssistanceDerivativeKeyValuePort extends AssistanceDerivativeKeyValuePort {
	putIfAbsentAndUpdate: NonNullable<AssistanceDerivativeKeyValuePort['putIfAbsentAndUpdate']>;
	replaceIfCurrent: NonNullable<AssistanceDerivativeKeyValuePort['replaceIfCurrent']>;
	replaceIfCurrentWhenCurrent: NonNullable<
		AssistanceDerivativeKeyValuePort['replaceIfCurrentWhenCurrent']
	>;
	deleteIfCurrentAndUpdate: NonNullable<
		AssistanceDerivativeKeyValuePort['deleteIfCurrentAndUpdate']
	>;
	deleteKeysIfCurrentAndUpdate: NonNullable<
		AssistanceDerivativeKeyValuePort['deleteKeysIfCurrentAndUpdate']
	>;
}

export function isAssistanceDerivativeKeyValuePort(
	value: unknown,
): value is AssistanceDerivativeKeyValuePort {
	return typeof (value as Partial<AssistanceDerivativeKeyValuePort>).listByPrefix === 'function'
		&& typeof (value as Partial<AssistanceDerivativeKeyValuePort>).putIfAbsent === 'function';
}

export function requireAtomicAssistanceDerivativeKeyValuePort(
	value: AssistanceDerivativeKeyValuePort,
): AtomicAssistanceDerivativeKeyValuePort {
	if (typeof value.putIfAbsentAndUpdate !== 'function'
		|| typeof value.replaceIfCurrent !== 'function'
		|| typeof value.replaceIfCurrentWhenCurrent !== 'function'
		|| typeof value.deleteIfCurrentAndUpdate !== 'function'
		|| typeof value.deleteKeysIfCurrentAndUpdate !== 'function') {
		throw new TypeError('Assistance derivative storage requires atomic inventory operations.');
	}
	return value as AtomicAssistanceDerivativeKeyValuePort;
}
