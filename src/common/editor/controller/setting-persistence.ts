/* SPDX-License-Identifier: AGPL-3.0-only */

export type SettingPersistencePolicy = 'required' | 'best-effort';

export interface SettingPersistenceOptions {
	readonly policy?: SettingPersistencePolicy;
}

export interface SettingPersistencePort {
	persist<Value>(
		key: string,
		value: Value,
		options?: SettingPersistenceOptions,
	): Promise<Value | null>;
}

export function createSettingPersistence({
	write,
	isInactive = () => false,
	onWarning = () => undefined,
}: {
	readonly write: (key: string, value: unknown) => Promise<unknown>;
	readonly isInactive?: () => boolean;
	readonly onWarning?: (error: unknown, key: string) => void;
}): Readonly<SettingPersistencePort> {
	if (typeof write !== 'function') throw new TypeError('A settings write port is required.');
	return Object.freeze({
		async persist<Value>(
			key: string,
			value: Value,
			{ policy = 'best-effort' }: SettingPersistenceOptions = {},
		): Promise<Value | null> {
			try {
				await write(key, value);
				return value;
			} catch (error) {
				if (!isInactive()) onWarning(error, key);
				if (policy === 'required') throw error;
				return null;
			}
		},
	});
}
