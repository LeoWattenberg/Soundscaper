export const STORE_CLOSED_CODE = 'STORE_CLOSED' as const;
export const STORE_BLOCKED_CODE = 'STORE_BLOCKED' as const;
export const STORE_VERSION_STALE_CODE = 'STORE_VERSION_STALE' as const;

export type EditorStoreState =
	| 'opening'
	| 'indexeddb'
	| 'memory-ephemeral'
	| 'version-stale'
	| 'error'
	| 'closing'
	| 'closed';

export type EditorStoreBackend = 'indexeddb' | 'memory';

export interface EditorStoreStatus {
	readonly state: EditorStoreState;
	readonly backend: EditorStoreBackend;
	readonly persistent: boolean;
	readonly ephemeral: boolean;
	readonly degradedReason: string | null;
}

export class EditorStoreClosedError extends Error {
	readonly code = STORE_CLOSED_CODE;

	constructor() {
		super('The audio editor project store is closed.');
		this.name = 'EditorStoreClosedError';
	}
}

export class EditorStoreBlockedError extends Error {
	readonly code = STORE_BLOCKED_CODE;

	constructor() {
		super('Editor storage is blocked by another tab.');
		this.name = 'EditorStoreBlockedError';
	}
}

export class EditorStoreVersionStaleError extends Error {
	readonly code = STORE_VERSION_STALE_CODE;

	constructor() {
		super('Editor storage changed in another tab and must be reopened by reloading the editor.');
		this.name = 'EditorStoreVersionStaleError';
	}
}

export function memoryFallbackReason(error: unknown): string | null {
	if (!error || typeof error !== 'object') return null;
	const name = 'name' in error ? String(error.name || '') : '';
	if (['SecurityError', 'NotAllowedError', 'InvalidStateError', 'QuotaExceededError'].includes(name)) {
		return name;
	}
	return null;
}
