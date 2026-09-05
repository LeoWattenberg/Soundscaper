/* SPDX-License-Identifier: AGPL-3.0-only */

type AnyMethod = (...args: never[]) => unknown;

/**
 * The keys of `Service` whose value is callable. An optional method counts: a
 * service that composes part of its surface conditionally still owes the facade
 * a name for it.
 */
export type DeferredFacadeMethodName<Service> = {
	[Name in keyof Service]-?: NonNullable<Service[Name]> extends AnyMethod ? Name : never;
}[keyof Service];

type DeferredMethod<Method> = NonNullable<Method> extends (...args: infer Args) => infer Result
	? (...args: Args) => Promise<Awaited<Result>>
	: never;

/** The deferred half of a facade: the real signature, awaited through the load. */
export type DeferredModuleFacade<Service, Names extends keyof Service> = Readonly<{
	[Name in Names]: DeferredMethod<Service[Name]>;
}>;

type UncoveredMethods<
	Service,
	Names extends readonly PropertyKey[],
	Eager,
	Covered extends readonly PropertyKey[],
> = Exclude<DeferredFacadeMethodName<Service>, Names[number] | keyof Eager | Covered[number]>;

/**
 * `unknown` when the tuple, the eager members and the declared companions cover
 * every method of `Service`, and otherwise a shape no name tuple satisfies, so
 * a method added to the service and left out of the tuple is a type error at
 * the facade that forgot it.
 */
type CoversEveryMethod<
	Service,
	Names extends readonly PropertyKey[],
	Eager,
	Covered extends readonly PropertyKey[],
> = [UncoveredMethods<Service, Names, Eager, Covered>] extends [never] ? unknown : Readonly<{
	deferredFacadeIsMissingMethods: UncoveredMethods<Service, Names, Eager, Covered>;
}>;

export interface DeferredModuleFacadeOptions<
	Eager extends Readonly<Record<string, unknown>>,
	Covered extends readonly PropertyKey[],
> {
	/** Shared seams that stay eager: they are exposed as-is and never deferred. */
	readonly eager?: Eager;
	/** Methods a sibling facade over the same service covers, for the completeness check. */
	readonly covered?: Covered;
}

/**
 * A facade over a module the editor loads on demand: every listed method keeps
 * its real signature, delegates to one cached load, and the tuple is checked at
 * compile time against the service it proxies, the way
 * `engine/runtime-methods.ts` checks the engine's public surface.
 *
 * A rejected load is not cached, so a transient chunk failure does not disable
 * the feature for the rest of the session. Overloaded methods collapse to their
 * last signature, which is what `Parameters` reports for them anywhere else.
 */
export function createDeferredModuleFacade<
	Service extends object,
	const Names extends readonly DeferredFacadeMethodName<Service>[],
	Eager extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
	const Covered extends readonly DeferredFacadeMethodName<Service>[] = [],
>(
	load: () => Promise<Service>,
	methodNames: Names & CoversEveryMethod<Service, Names, Eager, Covered>,
	options: DeferredModuleFacadeOptions<Eager, Covered> = {},
): Readonly<DeferredModuleFacade<Service, Names[number]> & Eager> {
	let pending: Promise<Service> | null = null;
	const loadService = (): Promise<Service> => {
		// The wrapper starts the load in this turn, so a facade that reports on its
		// own loading sees the request the moment a method is called.
		pending ??= (async () => load())().catch((error: unknown) => {
			pending = null;
			throw error;
		});
		return pending;
	};
	const facade: Record<PropertyKey, unknown> = {};
	for (const name of methodNames as Names) {
		facade[name] = async (...args: readonly unknown[]): Promise<unknown> => {
			const service = await loadService();
			const method = service[name];
			if (typeof method !== 'function') {
				throw new TypeError(`The deferred module does not implement ${String(name)}.`);
			}
			return await Reflect.apply(method as AnyMethod, service, args);
		};
	}
	return Object.freeze(Object.assign(facade, options.eager)) as
		Readonly<DeferredModuleFacade<Service, Names[number]> & Eager>;
}
