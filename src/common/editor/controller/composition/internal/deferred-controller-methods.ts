/* SPDX-License-Identifier: AGPL-3.0-only */

type MethodName<Service> = {
	[Key in keyof Service]: Service[Key] extends (...args: never[]) => unknown ? Key : never;
}[keyof Service];

/**
 * Bind mutually dependent controller services without reading an uninitialized
 * service during assembly. Each port retains the owning method's full type.
 * This performs no queueing: calls have the owner's normal return/throw behavior.
 */
export function deferControllerMethods<Service extends object, Key extends MethodName<Service>>(
	getService: () => Service,
	names: readonly Key[],
): Readonly<Pick<Service, Key>> {
	const entries = names.map((name) => [name, (...args: unknown[]): unknown => {
		const service = getService();
		const method = service[name];
		if (typeof method !== 'function') throw new TypeError(`Controller method ${String(name)} is unavailable.`);
		return Reflect.apply(method, service, args) as unknown;
	}]);
	// Every supplied name receives a callable forwarding the exact arguments and
	// result unchanged. Object.fromEntries cannot express that key/value relation.
	return Object.freeze(Object.fromEntries(entries)) as Readonly<Pick<Service, Key>>;
}

type AsyncMethods<Service, Key extends keyof Service> = {
	readonly [Name in Key]: Service[Name] extends (...args: infer Args) => infer Result
		? (...args: Args) => Promise<Awaited<Result>> : never;
};

/** Preserve an asynchronous public wrapper, including rejection of synchronous errors. */
export function deferAsyncControllerMethods<Service extends object, Key extends MethodName<Service>>(
	getService: () => Service,
	names: readonly Key[],
): AsyncMethods<Service, Key> {
	const methods = deferControllerMethods(getService, names);
	const entries = names.map((name) => [name, async (...args: unknown[]): Promise<unknown> => {
		const method = methods[name];
		if (typeof method !== 'function') throw new TypeError(`Controller method ${String(name)} is unavailable.`);
		return Reflect.apply(method, undefined, args) as unknown;
	}]);
	// The only transformation to each owning signature is Promise resolution.
	return Object.freeze(Object.fromEntries(entries)) as AsyncMethods<Service, Key>;
}
