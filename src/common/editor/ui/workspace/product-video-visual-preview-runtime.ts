/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProductVideoVisualPreviewLedger {
	readonly requestedNodeIds: readonly string[];
	readonly consumedNodeIds: readonly string[];
	readonly omittedNodeIds: readonly string[];
}

export interface ProductVideoVisualPreviewFrame {
	readonly layers: readonly Readonly<{
		readonly trackId: string;
		readonly trackIndex: number;
		readonly entries: readonly Readonly<Record<string, unknown>>[];
		readonly blendMode?: string;
	}>[];
	readonly adjustments: readonly Readonly<{
		readonly nodeId: string;
		readonly targetTrackIds: readonly string[];
		readonly effects: readonly unknown[];
		readonly opacity: number;
		readonly blendMode: string;
		readonly maskIds: readonly string[];
	}>[];
	readonly activeFreezeNodeIds: readonly string[];
	readonly availablePresetIds: readonly string[];
	readonly ledger: ProductVideoVisualPreviewLedger;
}

export interface ProductVideoVisualPreviewSession {
	resolve(timelineSample: number): ProductVideoVisualPreviewFrame;
	resolveTransitionWeight(clipId: string, timelineSample: number): number | null;
	dispose(): void;
}

export interface ProductVideoVisualPreviewCreateRequest {
	readonly project: unknown;
	readonly width: number;
	readonly height: number;
}

export interface ProductVideoVisualProjectBinThumbnailRequest
	extends ProductVideoVisualPreviewCreateRequest {
	readonly clipId: string;
	readonly signal?: AbortSignal;
}

export interface ProductVideoVisualProjectBinThumbnail {
	readonly clipId: string;
	readonly sourceId: string;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
	readonly opacity: number;
	readonly blendMode: string;
	readonly presentationIds: readonly string[];
	readonly maskIds: readonly string[];
}

export interface ProductVideoVisualPreviewRuntime {
	create(request: ProductVideoVisualPreviewCreateRequest): Promise<ProductVideoVisualPreviewSession | null>;
	createProjectBinThumbnail?(
		request: ProductVideoVisualProjectBinThumbnailRequest,
	): Promise<ProductVideoVisualProjectBinThumbnail | null>;
}

const RUNTIMES = new WeakSet<ProductVideoVisualPreviewRuntime>();
const OWNER_RUNTIMES = new WeakMap<object, ProductVideoVisualPreviewRuntime>();

export function createProductVideoVisualPreviewRuntime(
	create: ProductVideoVisualPreviewRuntime['create'],
	createProjectBinThumbnail?: ProductVideoVisualPreviewRuntime['createProjectBinThumbnail'],
): ProductVideoVisualPreviewRuntime {
	if (typeof create !== 'function') throw new TypeError('A product visual-preview factory is required.');
	if (createProjectBinThumbnail !== undefined && typeof createProjectBinThumbnail !== 'function') {
		throw new TypeError('A product project-bin thumbnail factory must be a function.');
	}
	const runtime = Object.freeze({ create, ...(createProjectBinThumbnail ? { createProjectBinThumbnail } : {}) });
	RUNTIMES.add(runtime);
	return runtime;
}

export function bindProductVideoVisualPreviewRuntime(
	owner: object,
	runtime: ProductVideoVisualPreviewRuntime,
): void {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function') || !RUNTIMES.has(runtime)) {
		throw new TypeError('Only an exact product visual-preview runtime can be bound.');
	}
	OWNER_RUNTIMES.set(owner, runtime);
}

export function productVideoVisualPreviewRuntimeFor(
	owner: unknown,
): ProductVideoVisualPreviewRuntime | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? OWNER_RUNTIMES.get(owner as object) ?? null : null;
}
