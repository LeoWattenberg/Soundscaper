/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Menu-only project mutations supplied by an exact Framescaper runtime.
 *
 * Selected V20 installs only render-queue enqueue. Dormant V25/V26 candidates
 * add their exact media and effect subsets. Keeping these calls renderer-owned
 * lets each controller commit through its validated history/store boundary
 * while desktop main owns only file, queue, and plug-in capabilities.
 */

export const FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES = Object.freeze([
	'image-sequence-import',
	'render-queue-enqueue',
	'proxy-generate',
	'proxy-attach',
	'proxy-detach',
	'proxy-relink',
	'ofx-add',
] as const);

export type FramescaperNativeProjectActionSurface =
	(typeof FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES)[number];

type FramescaperNativeProjectAction = (request?: unknown) => void | PromiseLike<void>;

export type FramescaperNativeProjectActions = Readonly<{
	[Surface in FramescaperNativeProjectActionSurface]: FramescaperNativeProjectAction;
}>;

export interface FramescaperNativeProjectActionRuntime {
	readonly surfaces: readonly FramescaperNativeProjectActionSurface[];
	run(surface: FramescaperNativeProjectActionSurface, request?: unknown): Promise<void>;
}

const SURFACE_SET = new Set<string>(FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES);
const RUNTIMES = new WeakSet<FramescaperNativeProjectActionRuntime>();
const OWNER_RUNTIMES = new WeakMap<object, FramescaperNativeProjectActionRuntime>();
const CARRIER_REGENERATORS = new WeakMap<FramescaperNativeProjectActionRuntime, (jobId: string) => Promise<void>>();

export function createFramescaperNativeProjectActionRuntime(
	actionsValue: FramescaperNativeProjectActions,
): FramescaperNativeProjectActionRuntime {
	return createFramescaperNativeProjectActionSubsetRuntime(
		FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
		actionsValue,
	);
}

/** Exact subset factory: selected V20 has one surface; candidates add their own. */
export function createFramescaperNativeProjectActionSubsetRuntime(
	surfacesValue: readonly FramescaperNativeProjectActionSurface[],
	actionsValue: Partial<FramescaperNativeProjectActions>,
): FramescaperNativeProjectActionRuntime {
	const surfaces = exactSurfaces(surfacesValue);
	const actions = exactActions(actionsValue, surfaces);
	const runtime = Object.freeze({
		surfaces,
		run: async (
			surfaceValue: FramescaperNativeProjectActionSurface,
			request?: unknown,
		): Promise<void> => {
			const surface = exactSurface(surfaceValue);
			const action = actions[surface];
			if (!action) throw new Error(`Framescaper candidate action ${surface} is unavailable.`);
			await action(request);
		},
	});
	RUNTIMES.add(runtime);
	return runtime;
}

/** Join disjoint menu-owned action slices without replacing another owner binding. */
export function composeFramescaperNativeProjectActionRuntimes(
	value: readonly FramescaperNativeProjectActionRuntime[],
): FramescaperNativeProjectActionRuntime {
	if (!Array.isArray(value) || value.length === 0
		|| value.length > FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES.length
		|| Reflect.ownKeys(value).length !== value.length + 1
		|| value.some((runtime) => !isFramescaperNativeProjectActionRuntime(runtime))) {
		throw new TypeError('Framescaper project-action composition requires exact runtimes.');
	}
	const actions: Partial<Record<FramescaperNativeProjectActionSurface, FramescaperNativeProjectAction>> = {};
	const surfaces: FramescaperNativeProjectActionSurface[] = [];
	for (const runtime of value as readonly FramescaperNativeProjectActionRuntime[]) {
		for (const surface of runtime.surfaces) {
			if (surfaces.includes(surface)) {
				throw new Error(`Framescaper project action ${surface} has more than one owner.`);
			}
			surfaces.push(surface);
			actions[surface] = (request) => runtime.run(surface, request);
		}
	}
	const composed = createFramescaperNativeProjectActionSubsetRuntime(surfaces, actions);
	const carrierOwner = value.find((runtime) => CARRIER_REGENERATORS.has(runtime));
	if (carrierOwner) CARRIER_REGENERATORS.set(composed,
		(jobId) => runFramescaperNativeCarrierRegeneration(carrierOwner, jobId));
	return composed;
}

export function bindFramescaperNativeCarrierRegeneration(
	runtime: FramescaperNativeProjectActionRuntime,
	action: (jobId: string) => Promise<void>,
): void {
	if (!isFramescaperNativeProjectActionRuntime(runtime)
		|| !runtime.surfaces.includes('render-queue-enqueue') || typeof action !== 'function'
		|| CARRIER_REGENERATORS.has(runtime)) {
		throw new TypeError('Carrier regeneration requires its exact render-queue runtime owner.');
	}
	CARRIER_REGENERATORS.set(runtime, action);
}

export async function runFramescaperNativeCarrierRegeneration(
	runtime: FramescaperNativeProjectActionRuntime,
	jobId: unknown,
): Promise<void> {
	if (!isFramescaperNativeProjectActionRuntime(runtime)
		|| typeof jobId !== 'string' || !/^[a-f0-9]{40}$/u.test(jobId)) {
		throw new TypeError('Carrier regeneration requires an exact durable queue job.');
	}
	const action = CARRIER_REGENERATORS.get(runtime);
	if (!action) throw new Error('The selected project cannot regenerate this renderer carrier.');
	await action(jobId);
}

export function hasFramescaperNativeCarrierRegeneration(
	runtime: FramescaperNativeProjectActionRuntime | null,
): boolean {
	return runtime !== null && isFramescaperNativeProjectActionRuntime(runtime)
		&& CARRIER_REGENERATORS.has(runtime);
}

export function isFramescaperNativeProjectActionRuntime(
	value: unknown,
): value is FramescaperNativeProjectActionRuntime {
	return Boolean(value && typeof value === 'object'
		&& RUNTIMES.has(value as FramescaperNativeProjectActionRuntime));
}

export function bindFramescaperNativeProjectActionRuntime(
	owner: object,
	runtime: FramescaperNativeProjectActionRuntime,
): void {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')
		|| !isFramescaperNativeProjectActionRuntime(runtime)) {
		throw new TypeError('Only an exact Framescaper candidate action runtime can be bound.');
	}
	OWNER_RUNTIMES.set(owner, runtime);
}

export function framescaperNativeProjectActionRuntimeFor(
	owner: unknown,
): FramescaperNativeProjectActionRuntime | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? OWNER_RUNTIMES.get(owner as object) ?? null
		: null;
}

export function isFramescaperNativeProjectActionSurface(
	value: unknown,
): value is FramescaperNativeProjectActionSurface {
	return typeof value === 'string' && SURFACE_SET.has(value);
}

function exactActions(
	value: unknown,
	surfaces: readonly FramescaperNativeProjectActionSurface[],
): Partial<FramescaperNativeProjectActions> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper requires a complete closed action set.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(record);
	if (keys.some((key) => typeof key !== 'string' || !SURFACE_SET.has(key))) {
		throw new TypeError('Framescaper candidate runtime supplied an unsupported action.');
	}
	if (keys.length !== surfaces.length || keys.some((key) => !surfaces.includes(
		key as FramescaperNativeProjectActionSurface,
	))) {
		throw new TypeError('Framescaper requires a complete closed action set.');
	}
	for (const surface of surfaces) {
		const descriptor = Object.getOwnPropertyDescriptor(record, surface);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'function') {
			throw new TypeError('Framescaper requires a complete closed action set.');
		}
	}
	return Object.freeze(Object.fromEntries(
		surfaces.map((surface) => [surface, record[surface]]),
	)) as Partial<FramescaperNativeProjectActions>;
}

function exactSurfaces(
	value: unknown,
): readonly FramescaperNativeProjectActionSurface[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > SURFACE_SET.size
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Framescaper candidate action surfaces must be a bounded dense array.');
	}
	const surfaces = value.map(exactSurface);
	if (new Set(surfaces).size !== surfaces.length) {
		throw new TypeError('Framescaper candidate action surfaces must be unique.');
	}
	return Object.freeze(surfaces);
}

function exactSurface(value: unknown): FramescaperNativeProjectActionSurface {
	if (typeof value !== 'string' || !SURFACE_SET.has(value)) {
		throw new RangeError('The Framescaper native project action surface is unsupported.');
	}
	return value as FramescaperNativeProjectActionSurface;
}
