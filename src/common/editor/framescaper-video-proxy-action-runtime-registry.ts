/* SPDX-License-Identifier: AGPL-3.0-only */

export type FramescaperVideoProxyModeRetime = 'original' | 'proxy' | 'auto';

export interface FramescaperVideoProxyPressureRetime {
	readonly droppedFrameRatio: number;
	readonly decodeQueueDepth: number;
	readonly viewportScale: number;
}

export type FramescaperVideoProxyProgressPhase =
	| 'queued'
	| 'generating'
	| 'validating'
	| 'publishing'
	| 'cleaning'
	| 'complete';

export interface FramescaperVideoProxyProgress {
	readonly phase: FramescaperVideoProxyProgressPhase;
	readonly completed: number;
	readonly total: 1;
}

export interface FramescaperVideoProxyOperationOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Readonly<FramescaperVideoProxyProgress>) => void;
}

export interface FramescaperVideoProxyOriginalRelinkCandidate {
	readonly file: File;
	readonly locator: Readonly<{ readonly locatorId: string; readonly locatorRevision: string }>;
}

export type FramescaperVideoProxyPreviewTrustRetime =
	| 'unverified'
	| 'verified'
	| 'stale'
	| 'unavailable';

export interface FramescaperVideoProxyActionRuntime {
	mode(sourceId: string): FramescaperVideoProxyModeRetime;
	previewTrust(sourceId: string): FramescaperVideoProxyPreviewTrustRetime;
	setMode(sourceId: string, mode: FramescaperVideoProxyModeRetime): Promise<void>;
	pressure(sourceId: string): Readonly<FramescaperVideoProxyPressureRetime> | null;
	reportPreviewPressure(
		sourceId: string,
		pressure: Readonly<FramescaperVideoProxyPressureRetime>,
	): Promise<void>;
	generate(sourceId: string, options?: FramescaperVideoProxyOperationOptions): Promise<void>;
	attachExisting(
		sourceId: string,
		candidate: Blob,
		options?: FramescaperVideoProxyOperationOptions,
	): Promise<void>;
	detach(sourceId: string): Promise<void>;
	regenerate(sourceId: string, options?: FramescaperVideoProxyOperationOptions): Promise<void>;
	relinkOriginal(
		sourceId: string,
		candidate: FramescaperVideoProxyOriginalRelinkCandidate,
		options?: Readonly<{ readonly allowChangedContent?: boolean }>,
	): Promise<'relinked' | 'confirmation-required'>;
}

const RUNTIMES = new WeakSet<FramescaperVideoProxyActionRuntime>();
const OWNER_RUNTIMES = new WeakMap<object, FramescaperVideoProxyActionRuntime>();

export function registerFramescaperVideoProxyActionRuntime(
	runtime: FramescaperVideoProxyActionRuntime,
): FramescaperVideoProxyActionRuntime {
	if (!runtime || typeof runtime !== 'object') {
		throw new TypeError('A Framescaper video-proxy action runtime is required.');
	}
	for (const method of [
		'mode', 'previewTrust', 'setMode', 'pressure', 'reportPreviewPressure',
		'generate', 'attachExisting', 'detach', 'regenerate', 'relinkOriginal',
	] as const) {
		if (typeof runtime[method] !== 'function') {
			throw new TypeError(`The Framescaper video-proxy runtime requires ${method}.`);
		}
	}
	RUNTIMES.add(runtime);
	return runtime;
}

export function bindFramescaperVideoProxyActionRuntime(
	owner: object,
	runtime: FramescaperVideoProxyActionRuntime,
): void {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')
		|| !RUNTIMES.has(runtime)) {
		throw new TypeError('Only an exact Framescaper video-proxy runtime can be bound.');
	}
	OWNER_RUNTIMES.set(owner, runtime);
}

export function framescaperVideoProxyActionRuntimeFor(
	owner: unknown,
): FramescaperVideoProxyActionRuntime | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? OWNER_RUNTIMES.get(owner as object) ?? null
		: null;
}
