/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ApplicationMenuResolution {
	readonly disabled: boolean;
	readonly disabledReason?: string;
}

export type MaterializedApplicationMenu<T> = T extends readonly (infer Item)[]
	? readonly MaterializedApplicationMenu<Item>[]
	: T extends object
		? {
			readonly [Key in keyof T as Key extends 'resolve' ? never : Key]:
				Key extends 'items' ? MaterializedApplicationMenu<T[Key]> : T[Key];
		}
		: T;

/** Resolve one menu-open snapshot without mutating or retaining deferred hooks. */
export function materializeApplicationMenu<const Menu extends object>(
	menu: Menu,
): MaterializedApplicationMenu<Menu> {
	return materializeMenuRecord(menu) as MaterializedApplicationMenu<Menu>;
}

function materializeMenuRecord(value: object): Readonly<Record<string, unknown>> {
	const input = value as Readonly<Record<string, unknown>>;
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(input)) {
		if (key === 'items' || key === 'resolve') continue;
		output[key] = input[key];
	}

	if (Array.isArray(input.items)) {
		output.items = Object.freeze(input.items.map((item) => (
			isMenuRecord(item) ? materializeMenuRecord(item) : item
		)));
	}

	if (Object.hasOwn(input, 'resolve')) {
		const resolution = resolveMenuItem(input);
		output.disabled = resolution.disabled;
		if (resolution.disabledReason === undefined) delete output.disabledReason;
		else output.disabledReason = resolution.disabledReason;
	}

	return Object.freeze(output);
}

function resolveMenuItem(input: Readonly<Record<string, unknown>>): Readonly<ApplicationMenuResolution> {
	try {
		const value = input.resolve;
		if (typeof value !== 'function') return FAILED_RESOLUTION;
		const resolution: unknown = value();
		if (!isMenuResolution(resolution)) return FAILED_RESOLUTION;
		return Object.freeze({
			disabled: resolution.disabled,
			...(resolution.disabledReason === undefined
				? {}
				: { disabledReason: resolution.disabledReason }),
		});
	} catch {
		return FAILED_RESOLUTION;
	}
}

function isMenuRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMenuResolution(value: unknown): value is Readonly<ApplicationMenuResolution> {
	return isMenuRecord(value)
		&& typeof value.disabled === 'boolean'
		&& (value.disabledReason === undefined || typeof value.disabledReason === 'string');
}

const FAILED_RESOLUTION = Object.freeze({ disabled: true });
