/* SPDX-License-Identifier: AGPL-3.0-only */

export type NativePluginStateQuiescencePurpose =
	| 'project-save'
	| 'scape-save'
	| 'aup4-save'
	| 'audio-export'
	| 'video-export'
	| 'track-freeze';

export interface NativePluginStateQuiescenceOwner {
	readonly project?: unknown;
}

export interface NativePluginStateQuiescenceProvider {
	capture(purpose: NativePluginStateQuiescencePurpose): PromiseLike<void> | void;
}

export interface NativePluginStateCaptureDependencies {
	readonly getProject: () => unknown;
	readonly isActive: (instanceId: string) => boolean;
	readonly persist: (instanceId: string) => PromiseLike<unknown> | unknown;
}

const providers = new WeakMap<object, NativePluginStateQuiescenceProvider>();

/** The renderer hosting the exact project owns its vendor-state capture authority. */
export function registerNativePluginStateQuiescence(
	owner: NativePluginStateQuiescenceOwner,
	provider: NativePluginStateQuiescenceProvider,
): () => void {
	const key = ownerKey(owner);
	if (!provider || typeof provider.capture !== 'function') {
		throw new TypeError('Native plug-in state quiescence requires one capture provider.');
	}
	if (providers.has(key)) {
		throw new Error('Native plug-in state quiescence already has an owner for this controller.');
	}
	providers.set(key, provider);
	return () => { if (providers.get(key) === provider) providers.delete(key); };
}

/** Serializes authenticated helper captures for every currently live instance. */
export function createNativePluginStateCaptureProvider(
	dependencies: NativePluginStateCaptureDependencies,
): NativePluginStateQuiescenceProvider {
	if (!dependencies || typeof dependencies.getProject !== 'function'
		|| typeof dependencies.isActive !== 'function' || typeof dependencies.persist !== 'function') {
		throw new TypeError('Native plug-in capture dependencies are incomplete.');
	}
	let tail: Promise<void> = Promise.resolve();
	const capture = (): Promise<void> => {
		tail = tail.then(run, run);
		return tail;
	};
	return Object.freeze({ capture });

	async function run(): Promise<void> {
		for (const instanceId of liveInstanceIds(dependencies.getProject())) {
			if (!dependencies.isActive(instanceId)) {
				throw new Error(`Native plug-in ${instanceId} is not restored for state capture.`);
			}
			await dependencies.persist(instanceId);
		}
	}
}

/** Save/render/freeze must never consume stale live vendor state. */
export async function quiesceNativePluginState(
	owner: NativePluginStateQuiescenceOwner,
	purpose: NativePluginStateQuiescencePurpose,
): Promise<void> {
	const key = ownerKey(owner);
	if (!hasLiveNativePluginState(owner.project)) return;
	const provider = providers.get(key);
	if (!provider) {
		throw new Error(`Native plug-in state capture is unavailable for ${purpose}.`);
	}
	await provider.capture(purpose);
	if (hasLiveNativePluginState(owner.project) && providers.get(key) !== provider) {
		throw new Error(`Native plug-in state capture ownership changed during ${purpose}.`);
	}
}

export function hasLiveNativePluginState(project: unknown): boolean {
	const states = (project as { readonly nativePluginStates?: unknown } | null)?.nativePluginStates;
	return Array.isArray(states) && states.some((state) => {
		const row = state as Readonly<Record<string, unknown>> | null;
		return row?.enabled === true && row.bypassed !== true && row.continuity === 'live';
	});
}

function liveInstanceIds(project: unknown): readonly string[] {
	const states = (project as { readonly nativePluginStates?: unknown } | null)?.nativePluginStates;
	if (!Array.isArray(states)) return Object.freeze([]);
	const ids = states.filter((state) => {
		const row = state as Readonly<Record<string, unknown>> | null;
		return row?.enabled === true && row.bypassed !== true && row.continuity === 'live';
	}).map((state) => (state as { instanceId?: unknown }).instanceId);
	if (ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id))) {
		throw new TypeError('A live native plug-in state has an invalid instance ID.');
	}
	if (new Set(ids).size !== ids.length) throw new TypeError('Live native plug-in instance IDs must be unique.');
	return Object.freeze(ids as string[]);
}

function ownerKey(owner: NativePluginStateQuiescenceOwner): object {
	if (!owner || typeof owner !== 'object') {
		throw new TypeError('Native plug-in state quiescence requires a controller owner.');
	}
	return owner;
}
