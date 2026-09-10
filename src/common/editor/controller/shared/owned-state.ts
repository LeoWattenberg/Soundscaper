/* SPDX-License-Identifier: AGPL-3.0-only */

export type DeepReadonly<Value> = Value extends string | number | boolean | bigint | symbol | null | undefined
	? Value
	: Value extends (...args: never[]) => unknown
	? Value
	: Value extends ReadonlyMap<infer Key, infer Entry>
		? ReadonlyMap<DeepReadonly<Key>, DeepReadonly<Entry>>
		: Value extends ReadonlySet<infer Entry>
			? ReadonlySet<DeepReadonly<Entry>>
		: Value extends readonly unknown[]
				? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
				: Value extends object
						? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
						: Value;

declare const OWNED_STATE_ACCESS: unique symbol;

/** Nominal capability carried only by a scoped view that may write this owner. */
export type OwnedStateWriteScope<
	State,
	Owner extends object,
	Writable extends object = Owner,
> = DeepReadonly<Omit<State, keyof Writable>> & Writable & {
	readonly [OWNED_STATE_ACCESS]: Owner;
};

export type OwnedStateAccess<State, Owner extends object> = Omit<State, keyof Owner> & Owner & {
	readonly [OWNED_STATE_ACCESS]: Owner;
};

/**
 * Expose an owner's fields on the flat controller state as live read accessors.
 * Mutations must use the explicit owner, while compatibility readers continue
 * to observe its current values from the flat state.
 */
export function exposeOwnedFields<Target extends object, Owner extends object>(
	target: Target,
	owner: Owner,
): Target & DeepReadonly<Owner> {
	const readonlyView = createDeepReadonlyView();
	for (const key of Object.keys(owner) as (keyof Owner & string)[]) {
		Object.defineProperty(target, key, {
			enumerable: true,
			configurable: false,
			get: () => readonlyView(owner[key]),
		});
	}
	return target as Target & DeepReadonly<Owner>;
}

/**
 * Give one composition write access to its explicit owner while retaining the
 * flat state for shared workspace fields and compatibility reads. Fields that
 * belong to another owner stay getter-only on the scoped view.
 */
export function createOwnedStateAccess<State extends object, Owner extends object>(
	state: State,
	owner: Owner,
): OwnedStateAccess<State, Owner> {
	const ownerKeys = new Set(Reflect.ownKeys(owner));
	const access = Object.create(null) as object;
	for (const key of Reflect.ownKeys(state)) {
		const descriptor = Object.getOwnPropertyDescriptor(state, key);
		if (!descriptor) continue;
		const owned = ownerKeys.has(key);
		const sharedWritable = !owned && ('value' in descriptor ? descriptor.writable === true : descriptor.set !== undefined);
		Object.defineProperty(access, key, {
			enumerable: descriptor.enumerable === true,
			configurable: false,
			get: () => Reflect.get(owned ? owner : state, key),
			...(owned || sharedWritable ? {
				set: (value: unknown) => {
					if (!Reflect.set(owned ? owner : state, key, value)) {
						throw new TypeError(`Controller state field ${String(key)} is not writable.`);
					}
				},
			} : {}),
		});
	}
	return access as OwnedStateAccess<State, Owner>;
}

type ReadonlyView = <Value>(value: Value) => DeepReadonly<Value>;

/** Build stable, recursive read views without freezing the owner's storage. */
function createDeepReadonlyView(): ReadonlyView {
	const views = new WeakMap<object, object>();
	const originals = new WeakMap<object, object>();

	const readonlyView: ReadonlyView = <Value>(value: Value): DeepReadonly<Value> => {
		if (!isObject(value) || originals.has(value)) return value as DeepReadonly<Value>;
		if (!isReadonlyViewCandidate(value)) return value as DeepReadonly<Value>;
		const existing = views.get(value);
		if (existing) return existing as DeepReadonly<Value>;
		const view = value instanceof Map
			? readonlyMapView(value, readonlyView, views, originals)
			: value instanceof Set
				? readonlySetView(value, readonlyView, views, originals)
				: readonlyObjectView(value, readonlyView, views, originals);
		return view as DeepReadonly<Value>;
	};
	return readonlyView;
}

function isObject(value: unknown): value is object {
	return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isReadonlyViewCandidate(value: object): boolean {
	if (Array.isArray(value) || value instanceof Map || value instanceof Set) return true;
	const prototype = Object.getPrototypeOf(value) as object | null;
	return prototype === null || prototype === Object.prototype;
}

function readonlyObjectView(
	target: object,
	readonlyView: ReadonlyView,
	views: WeakMap<object, object>,
	originals: WeakMap<object, object>,
): object {
	const shadow = Array.isArray(target)
		? []
		: Object.create(Object.getPrototypeOf(target)) as object;
	const view = new Proxy(shadow, readonlyProxyHandler(readonlyView, target));
	views.set(target, view);
	originals.set(view, target);
	return view;
}

function readonlyMapView(
	target: Map<unknown, unknown>,
	readonlyView: ReadonlyView,
	views: WeakMap<object, object>,
	originals: WeakMap<object, object>,
): object {
	const get = (entryKey: unknown) => readonlyView(target.get(originalValue(entryKey, originals)));
	const has = (entryKey: unknown) => target.has(originalValue(entryKey, originals));
	const keys = () => mapIterator(target.keys(), readonlyView);
	const values = () => mapIterator(target.values(), readonlyView);
	const entries = () => mapEntryIterator(target.entries(), readonlyView);
	const forEach = (
		callback: (entry: unknown, entryKey: unknown, source: ReadonlyMap<unknown, unknown>) => void,
		thisArg?: unknown,
	) => {
		target.forEach((entry, entryKey) => {
			callback.call(thisArg, readonlyView(entry), readonlyView(entryKey), view);
		});
	};
	const view = new Proxy(new Map<unknown, unknown>(), {
		...readonlyProxyHandler(readonlyView),
		get(_map, key) {
			if (key === 'set' || key === 'delete' || key === 'clear') return rejectReadonlyMutation;
			if (key === 'get') return get;
			if (key === 'has') return has;
			if (key === 'keys') return keys;
			if (key === 'values') return values;
			if (key === 'entries' || key === Symbol.iterator) return entries;
			if (key === 'forEach') return forEach;
			return readonlyView(Reflect.get(target, key, target));
		},
	}) as ReadonlyMap<unknown, unknown>;
	views.set(target, view);
	originals.set(view, target);
	return view;
}

function readonlySetView(
	target: Set<unknown>,
	readonlyView: ReadonlyView,
	views: WeakMap<object, object>,
	originals: WeakMap<object, object>,
): object {
	const has = (entry: unknown) => target.has(originalValue(entry, originals));
	const values = () => mapIterator(target.values(), readonlyView);
	const entries = () => setEntryIterator(target.values(), readonlyView);
	const forEach = (
		callback: (entry: unknown, entryAgain: unknown, source: ReadonlySet<unknown>) => void,
		thisArg?: unknown,
	) => {
		target.forEach((entry) => {
			const readonlyEntry = readonlyView(entry);
			callback.call(thisArg, readonlyEntry, readonlyEntry, view);
		});
	};
	const view = new Proxy(new Set<unknown>(), {
		...readonlyProxyHandler(readonlyView),
		get(_set, key) {
			if (key === 'add' || key === 'delete' || key === 'clear') return rejectReadonlyMutation;
			if (key === 'has') return has;
			if (key === 'keys' || key === 'values' || key === Symbol.iterator) return values;
			if (key === 'entries') return entries;
			if (key === 'forEach') return forEach;
			return readonlyView(Reflect.get(target, key, target));
		},
	}) as ReadonlySet<unknown>;
	views.set(target, view);
	originals.set(view, target);
	return view;
}

function readonlyProxyHandler(readonlyView: ReadonlyView, source?: object): ProxyHandler<object> {
	return {
		get: (target, key) => {
			const origin = source ?? target;
			return readonlyView(Reflect.get(origin, key, origin));
		},
		...(source ? {
			has: (_target: object, key: PropertyKey) => Reflect.has(source, key),
			ownKeys: () => Reflect.ownKeys(source),
			getOwnPropertyDescriptor: (target: object, key: PropertyKey) => (
				readonlyPropertyDescriptor(target, source, key, readonlyView)
			),
		} : {}),
		set: rejectReadonlyMutation,
		deleteProperty: rejectReadonlyMutation,
		defineProperty: rejectReadonlyMutation,
		setPrototypeOf: rejectReadonlyMutation,
		preventExtensions: rejectReadonlyMutation,
	};
}

function readonlyPropertyDescriptor(
	target: object,
	source: object,
	key: PropertyKey,
	readonlyView: ReadonlyView,
): PropertyDescriptor | undefined {
	const fixed = Reflect.getOwnPropertyDescriptor(target, key);
	const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
	if (!descriptor) return fixed;
	if (fixed?.configurable === false) {
		return 'value' in fixed
			? { ...fixed, value: readonlyView(Reflect.get(source, key, source)) }
			: fixed;
	}
	if ('value' in descriptor) {
		return {
			configurable: true,
			enumerable: descriptor.enumerable === true,
			writable: false,
			value: readonlyView(descriptor.value),
		};
	}
	return {
		configurable: true,
		enumerable: descriptor.enumerable === true,
		get: () => readonlyView(Reflect.get(source, key, source)),
	};
}

function rejectReadonlyMutation(): never {
	throw new TypeError('Controller compatibility state is read-only.');
}

function originalValue(value: unknown, originals: WeakMap<object, object>): unknown {
	return isObject(value) ? originals.get(value) ?? value : value;
}

function *mapIterator(
	iterator: Iterator<unknown>,
	readonlyView: ReadonlyView,
): Generator<unknown, void, unknown> {
	for (let next = iterator.next(); !next.done; next = iterator.next()) {
		yield readonlyView(next.value);
	}
}

function *mapEntryIterator(
	iterator: Iterator<[unknown, unknown]>,
	readonlyView: ReadonlyView,
): Generator<readonly [unknown, unknown], void, unknown> {
	for (let next = iterator.next(); !next.done; next = iterator.next()) {
		yield Object.freeze([readonlyView(next.value[0]), readonlyView(next.value[1])] as const);
	}
}

function *setEntryIterator(
	iterator: Iterator<unknown>,
	readonlyView: ReadonlyView,
): Generator<readonly [unknown, unknown], void, unknown> {
	for (let next = iterator.next(); !next.done; next = iterator.next()) {
		const entry = readonlyView(next.value);
		yield Object.freeze([entry, entry] as const);
	}
}
