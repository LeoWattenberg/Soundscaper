/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-only authoring entry points shared by dormant lineages and selected V27. */
export const FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES = Object.freeze([
	'video-transition',
	'video-transition-dissolve',
	'video-still',
	'video-title',
	'video-text',
	'video-shape',
	'video-solid',
	'video-external-generator',
	'video-adjustment-layer',
	'video-visual-preset',
	'video-mask-matte',
	'video-freeze',
] as const);

export type FramescaperCandidateAuthoringSurface =
	(typeof FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES)[number];

type AuthoringAction = () => void | PromiseLike<void>;
export type FramescaperCandidateAuthoringActions = Readonly<Record<
	FramescaperCandidateAuthoringSurface,
	AuthoringAction
>>;

export interface FramescaperCandidateAuthoringActionRuntime {
	readonly surfaces: readonly FramescaperCandidateAuthoringSurface[];
	run(surface: FramescaperCandidateAuthoringSurface): Promise<void>;
}

const SURFACES = new Set<string>(FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES);
const RUNTIMES = new WeakSet<FramescaperCandidateAuthoringActionRuntime>();
const OWNER_RUNTIMES = new WeakMap<object, FramescaperCandidateAuthoringActionRuntime>();

export function createFramescaperCandidateAuthoringActionSubsetRuntime(
	surfacesValue: readonly FramescaperCandidateAuthoringSurface[],
	actionsValue: Partial<FramescaperCandidateAuthoringActions>,
): FramescaperCandidateAuthoringActionRuntime {
	const surfaces = exactSurfaces(surfacesValue);
	const actions = exactActions(actionsValue, surfaces);
	const runtime = Object.freeze({
		surfaces,
		run: async (surfaceValue: FramescaperCandidateAuthoringSurface): Promise<void> => {
			const surface = exactSurface(surfaceValue);
			const action = actions[surface];
			if (!action) throw new Error(`Framescaper candidate authoring ${surface} is unavailable.`);
			await action();
		},
	});
	RUNTIMES.add(runtime);
	return runtime;
}

export function bindFramescaperCandidateAuthoringActionRuntime(
	owner: object,
	runtime: FramescaperCandidateAuthoringActionRuntime,
): void {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function') || !RUNTIMES.has(runtime)) {
		throw new TypeError('Only an exact dormant Framescaper authoring runtime can be bound.');
	}
	OWNER_RUNTIMES.set(owner, runtime);
}

export function framescaperCandidateAuthoringActionRuntimeFor(
	owner: unknown,
): FramescaperCandidateAuthoringActionRuntime | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? OWNER_RUNTIMES.get(owner as object) ?? null
		: null;
}

function exactSurfaces(value: unknown): readonly FramescaperCandidateAuthoringSurface[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > SURFACES.size
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Candidate authoring surfaces must be a bounded dense array.');
	}
	const surfaces = value.map(exactSurface);
	if (new Set(surfaces).size !== surfaces.length) {
		throw new TypeError('Candidate authoring surfaces must be unique.');
	}
	return Object.freeze(surfaces);
}

function exactSurface(value: unknown): FramescaperCandidateAuthoringSurface {
	if (typeof value !== 'string' || !SURFACES.has(value)) {
		throw new RangeError('The Framescaper candidate authoring surface is unsupported.');
	}
	return value as FramescaperCandidateAuthoringSurface;
}

function exactActions(
	value: unknown,
	surfaces: readonly FramescaperCandidateAuthoringSurface[],
): Partial<FramescaperCandidateAuthoringActions> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Candidate authoring requires an exact action record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== surfaces.length || keys.some((key) => (
		typeof key !== 'string' || !surfaces.includes(key as FramescaperCandidateAuthoringSurface)
	))) {
		throw new TypeError('Candidate authoring requires an exact action record.');
	}
	for (const surface of surfaces) {
		const descriptor = Object.getOwnPropertyDescriptor(value, surface);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'function') {
			throw new TypeError('Candidate authoring requires an exact action record.');
		}
	}
	return Object.freeze(Object.fromEntries(surfaces.map((surface) => [
		surface, (value as Readonly<Record<string, AuthoringAction>>)[surface],
	]))) as Partial<FramescaperCandidateAuthoringActions>;
}
