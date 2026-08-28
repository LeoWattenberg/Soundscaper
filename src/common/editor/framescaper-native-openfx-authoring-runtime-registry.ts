/* SPDX-License-Identifier: AGPL-3.0-only */

const AUTHORING_RUNTIMES = new WeakMap<object, object>();

export function bindFramescaperNativeOpenFxAuthoringRuntimeNativeMedia(owner: object, runtime: object): void {
	if (!owner || typeof owner !== 'object' || !runtime || typeof runtime !== 'object') {
		throw new TypeError('Selected V28 OpenFX authoring binding requires exact owner and runtime objects.');
	}
	AUTHORING_RUNTIMES.set(owner, runtime);
}

export function framescaperNativeOpenFxAuthoringRuntimeForNativeMedia(owner: unknown): object | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? AUTHORING_RUNTIMES.get(owner as object) ?? null : null;
}

export function adoptFramescaperNativeOpenFxAuthoringRuntimeNativeMedia(from: object, to: object): void {
	const runtime = AUTHORING_RUNTIMES.get(from);
	if (!runtime || !to || typeof to !== 'object') {
		throw new TypeError('Selected V28 OpenFX authoring adoption requires exact owners.');
	}
	AUTHORING_RUNTIMES.set(to, runtime);
}
