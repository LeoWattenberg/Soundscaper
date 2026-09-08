/* SPDX-License-Identifier: AGPL-3.0-only */

/** Synchronous binding generations for leases spanning asynchronous linked-video work. */

const generations = new WeakMap<object, Map<string, string>>();

export function linkedVideoOriginalGenerationToken(
	storageKey: string,
	sourceContentSha256: unknown,
	binding: unknown,
): string {
	const record = binding && typeof binding === 'object'
		? binding as Readonly<Record<string, unknown>> : {};
	const token = typeof record.bindingToken === 'string' && record.bindingToken
		? record.bindingToken : String(sourceContentSha256 ?? storageKey);
	const revision = typeof record.locatorRevision === 'string' && record.locatorRevision
		? record.locatorRevision : '0';
	return `linked:${token}:${revision}`;
}

export function rememberLinkedVideoOriginalGeneration(
	store: object,
	projectId: string,
	sourceId: string,
	generation: string,
): void {
	let storeGenerations = generations.get(store);
	if (!storeGenerations) {
		storeGenerations = new Map();
		generations.set(store, storeGenerations);
	}
	storeGenerations.set(key(projectId, sourceId), generation);
}

export function currentLinkedVideoOriginalGeneration(
	store: object,
	projectId: string,
	sourceId: string,
): string | null {
	return generations.get(store)?.get(key(projectId, sourceId)) ?? null;
}

function key(projectId: string, sourceId: string): string {
	return `${projectId.length}:${projectId}${sourceId}`;
}
