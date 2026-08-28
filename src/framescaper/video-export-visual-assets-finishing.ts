/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	parseCubeLutV1,
	type ParsedCubeLutV1,
	type VideoCubeLutReferenceV1,
} from '../common/editor/video-color-management-v27.ts';
import type { UnifiedExactRenderVisualRgbaV13 } from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperVideoExportFinishingAssetStoreFinishing } from './video-export-finishing-finishing.ts';

export interface FramescaperVideoExportVisualAssetStoreFinishing extends FramescaperVideoExportFinishingAssetStoreFinishing {
	decodeStillAsset?(request: Readonly<{
		readonly source: Readonly<Record<string, unknown>>;
		readonly blob: Blob;
		readonly signal: AbortSignal;
	}>): PromiseLike<UnifiedExactRenderVisualRgbaV13>;
}

export interface FramescaperVideoExportVisualAssetsFinishing {
	readonly stills: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>;
	readonly luts: ReadonlyMap<string, ParsedCubeLutV1>;
}

interface LoadRequest {
	readonly store?: FramescaperVideoExportVisualAssetStoreFinishing;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

const MAXIMUM_VISUAL_ASSETS = 512;
const MAXIMUM_VISUAL_ASSET_BYTES = 512 * 1024 * 1024;

/** Authenticate and decode all external still and LUT bodies before frame execution. */
export async function loadFramescaperVideoExportVisualAssetsFinishing(
	request: LoadRequest,
	plan: UnifiedExactRenderPlanV13,
	finishing: UnifiedExactRenderFinishingNode,
): Promise<FramescaperVideoExportVisualAssetsFinishing> {
	const stillSources = unique(plan.nodes.flatMap((node) => (
		node.kind === 'visual' && node.modelKind === 'still' && 'source' in node.authoredState
			? [record(node.authoredState.source, 'finishing visual still source')] : []
	)), (source) => String(source.id));
	const visualOwnerIds = new Set(plan.nodes.flatMap((node) => node.kind !== 'visual' ? [] : [
		node.modelId,
		...('source' in node.authoredState ? [node.authoredState.source.id] : []),
	]));
	const lutReferences = unique(finishing.visualPresentations.flatMap(({ owner, grade }) => (
		grade?.lut && visualOwnerIds.has(owner.id) ? [grade.lut] : []
	)), ({ sha256: digestValue }) => digestValue);
	if (stillSources.length + lutReferences.length > MAXIMUM_VISUAL_ASSETS) {
		throw new RangeError('finishing visual export assets exceed their count bound.');
	}
	if ((stillSources.length > 0 || lutReferences.length > 0) && request.store === undefined) {
		throw new Error('finishing visual export assets are unavailable.');
	}
	let totalBytes = 0;
	const stills = new Map<string, UnifiedExactRenderVisualRgbaV13>();
	for (const source of stillSources) {
		const blob = await loadBlob(request, stableId(source.storageKey, 'finishing still storage key'));
		totalBytes = boundedTotal(totalBytes, blob.size);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		assertReady(request);
		if (bytesToHex(sha256(bytes)) !== digest(source.contentSha256, 'finishing still digest')) {
			throw new RangeError(`finishing still ${String(source.id)} is missing or stale.`);
		}
		const canonical = new Blob([bytes], { type: String(source.mimeType) });
		const decoded = request.store!.decodeStillAsset
			? await request.store!.decodeStillAsset({ source, blob: canonical, signal: request.signal })
			: await decodeStill(source, canonical, request.signal);
		assertReady(request);
		assertDecodedStill(source, decoded);
		stills.set(stableId(source.id, 'finishing still source'), Object.freeze({
			width: decoded.width, height: decoded.height,
			pixels: decoded.pixels.slice() as Uint8Array<ArrayBuffer>,
		}));
		bytes.fill(0);
	}
	const luts = new Map<string, ParsedCubeLutV1>();
	for (const reference of lutReferences) {
		const blob = await loadBlob(request, reference.storageKey);
		totalBytes = boundedTotal(totalBytes, blob.size);
		const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
		assertReady(request);
		const parsed = parseCubeLutV1(text);
		assertLut(reference, parsed);
		luts.set(reference.sha256, parsed);
	}
	return Object.freeze({ stills, luts });
}

async function loadBlob(request: LoadRequest, storageKey: string): Promise<Blob> {
	assertReady(request);
	const value = await request.store!.loadMediaAsset(storageKey, { signal: request.signal });
	assertReady(request);
	if (!value || !Number.isSafeInteger(value.size) || value.size < 1
		|| typeof value.arrayBuffer !== 'function') {
		throw new Error(`finishing visual asset ${storageKey} is missing or stale.`);
	}
	return value instanceof Blob ? value : new Blob([await value.arrayBuffer()]);
}

async function decodeStill(
	source: Readonly<Record<string, unknown>>,
	blob: Blob,
	signal: AbortSignal,
): Promise<UnifiedExactRenderVisualRgbaV13> {
	if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document) {
		throw new Error('finishing still decode is unavailable in this browser.');
	}
	throwIfAborted(signal);
	const bitmap = await globalThis.createImageBitmap(blob, {
		colorSpaceConversion: 'none', premultiplyAlpha: 'none',
	});
	try {
		throwIfAborted(signal);
		const width = positiveInteger(source.width, 'finishing still width');
		const height = positiveInteger(source.height, 'finishing still height');
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('finishing still decode canvas is unavailable.');
		context.clearRect(0, 0, width, height);
		context.drawImage(bitmap, 0, 0, width, height);
		const data = context.getImageData(0, 0, width, height).data;
		return Object.freeze({ width, height, pixels: Uint8Array.from(data) as Uint8Array<ArrayBuffer> });
	} finally { bitmap.close(); }
}

function assertDecodedStill(source: Readonly<Record<string, unknown>>, frame: UnifiedExactRenderVisualRgbaV13): void {
	if (frame.width !== source.width || frame.height !== source.height
		|| !(frame.pixels instanceof Uint8Array)
		|| frame.pixels.byteLength !== frame.width * frame.height * 4) {
		throw new RangeError(`finishing decoded still ${String(source.id)} geometry is stale.`);
	}
}

function assertLut(reference: VideoCubeLutReferenceV1, parsed: ParsedCubeLutV1): void {
	if (reference.sha256 !== parsed.sha256 || reference.byteLength !== parsed.byteLength
		|| reference.size !== parsed.size
		|| JSON.stringify(reference.domainMin) !== JSON.stringify(parsed.domainMin)
		|| JSON.stringify(reference.domainMax) !== JSON.stringify(parsed.domainMax)) {
		throw new RangeError('finishing visual LUT is missing or stale.');
	}
}

function boundedTotal(total: number, added: number): number {
	const result = total + added;
	if (!Number.isSafeInteger(result) || result > MAXIMUM_VISUAL_ASSET_BYTES) {
		throw new RangeError('finishing visual export assets exceed their byte bound.');
	}
	return result;
}

function unique<Value>(values: readonly Value[], key: (value: Value) => string): readonly Value[] {
	return [...new Map(values.map((value) => [key(value), value])).values()];
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} is invalid.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function assertReady(request: LoadRequest): void {
	throwIfAborted(request.signal);
	request.assertCurrent();
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('finishing visual export was cancelled.', 'AbortError');
}
