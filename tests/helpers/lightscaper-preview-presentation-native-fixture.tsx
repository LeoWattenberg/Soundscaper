/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { withPixelFrameBodyV1 } from '../../src/common/editor/imaging/pixel-frame-body-v1.ts';
import { clearPixelFrameCanvasV1, paintPixelFrameCanvasV1 } from '../../src/common/editor/imaging/pixel-frame-canvas-presenter-v1.ts';
import type { PixelFrameDescriptorV1 } from '../../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryPreviewOutcomeV1, PhotoLibraryPreviewTierV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import PhotoPreviewPresentation from '../../src/common/editor/ui/lightscaper/PhotoPreviewPresentation.tsx';
import { permuteExifRgbaV1 } from './lightscaper-photo-orientation-oracle.ts';

const limits = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 2048 * 2048, maximumBytes: 16 * 1024 * 1024 });
const nativeDescriptor = (width: number, height: number): Readonly<PixelFrameDescriptorV1> => Object.freeze({
	schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb',
});

export async function qualifyPixelCanvasNativeV1() {
	const seed = new Uint8Array([255, 0, 0, 255, 17, 31, 63, 127, 0, 0, 0, 0,
		0, 255, 0, 255, 0, 0, 255, 255, 41, 83, 167, 255]);
	const oriented = permuteExifRgbaV1(seed, 3, 2, 6), descriptor = nativeDescriptor(2, 3);
	const canvas = document.createElement('canvas'); document.body.append(canvas);
	let borrowed: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | null = null;
	const body = new Blob([oriented.rgba.slice()], { type: 'application/vnd.scaper.rgba8' });
	const expectedDigest = bytesToHex(sha256(oriented.rgba));
	await withPixelFrameBodyV1({ descriptor, byteLength: oriented.rgba.length, outputSha256: expectedDigest, body }, frame => {
		if (!(frame.pixels instanceof Uint8Array || frame.pixels instanceof Uint8ClampedArray)) throw new Error('The native presenter admitted another route.');
		borrowed = frame.pixels;
		paintPixelFrameCanvasV1(canvas, frame, { limits });
	}, { limits });
	const pixels = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })!.getImageData(0, 0, 2, 3).data;
	const aliases = new Uint8ClampedArray(4), imageData = new ImageData(aliases, 1, 1, { colorSpace: 'srgb' });
	const source = borrowed as Uint8Array<ArrayBuffer> | null;
	const result = { width: canvas.width, height: canvas.height, pixels: [...pixels], oracle: [...oriented.rgba],
		imageDataAliases: imageData.data.buffer === aliases.buffer, stagedPixelsWiped: source !== null && source.every(value => value === 0),
		bodyDigestUnchanged: bytesToHex(sha256(new Uint8Array(await body.arrayBuffer()))) === expectedDigest };
	clearPixelFrameCanvasV1(canvas);
	const opaque = document.createElement('canvas'), priorContext = opaque.getContext('2d', { alpha: false, colorSpace: 'srgb' })!;
	priorContext.clearRect(0, 0, 1, 1);
	const priorContextWasOpaque = priorContext.getImageData(0, 0, 1, 1).data[3] === 255;
	let opaqueRefused = false, ignoredOptionPreservesAlpha = false;
	await withPixelFrameBodyV1({ descriptor, byteLength: oriented.rgba.length, outputSha256: expectedDigest, body }, frame => {
		try {
			paintPixelFrameCanvasV1(opaque, frame, { limits });
			const observed = priorContext.getImageData(0, 0, 2, 3).data;
			ignoredOptionPreservesAlpha = observed.every((value, index) => index % 4 !== 3 || value === oriented.rgba[index]);
		}
		catch (error) { opaqueRefused = error instanceof RangeError && /alpha/u.test(error.message); }
	}, { limits });
	clearPixelFrameCanvasV1(opaque);
	return { ...result, releasedWidth: canvas.width, releasedHeight: canvas.height, opaqueRefused, priorContextWasOpaque, ignoredOptionPreservesAlpha,
		opaqueReleased: opaque.width === 0 && opaque.height === 0 };
}

interface PreparedBody { readonly descriptor: Readonly<PixelFrameDescriptorV1>; readonly byteLength: number; readonly outputSha256: string; readonly body: Blob }
export function createPreviewPresentationBodyFixtureV1(side: number): PreparedBody {
	const pixels = new Uint8Array(side * side * 4);
	for (let index = 0; index < pixels.length; index += 4) { pixels[index] = 19; pixels[index + 1] = 47; pixels[index + 2] = 91; pixels[index + 3] = 255; }
	const outputSha256 = bytesToHex(sha256(pixels)), body = new Blob([pixels], { type: 'application/vnd.scaper.rgba8' });
	pixels.fill(0);
	return Object.freeze({ descriptor: nativeDescriptor(side, side), byteLength: side * side * 4, outputSha256, body });
}

const calls: string[] = [];
let active = 0, maximumActive = 0, holdNext = false, heldSignal: AbortSignal | null = null;
let releaseHeld: (() => void) | null = null;
let retainedCanvases: HTMLCanvasElement[] = [];

export function holdNextPreviewNativeV1() { holdNext = true; }
export function releaseHeldPreviewNativeV1() { releaseHeld?.(); releaseHeld = null; }
export function previewPresentationStateNativeV1() {
	return { calls: [...calls], active, maximumActive, heldAborted: heldSignal?.aborted ?? false,
		detachedDimensions: retainedCanvases.map(canvas => [canvas.width, canvas.height]) };
}

export function mountPreviewPresentationNativeV1() {
	const thumbnail = createPreviewPresentationBodyFixtureV1(512), fitScreen = createPreviewPresentationBodyFixtureV1(2048);
	const host = document.createElement('main'); document.body.append(host);
	function Harness() {
		const [thumbnailsVisible, setThumbnails] = useState(false), [loupe, setLoupe] = useState(false);
		const [page, setPage] = useState(0), [factory, setFactory] = useState(0), [mounted, setMounted] = useState(true);
		const photoIds = Array.from({ length: 64 }, (_item, index) => `page-${page}-photo-${index}`);
		const readPreview = useCallback(async (photoId: string, tier: PhotoLibraryPreviewTierV1, options: Readonly<{ signal: AbortSignal }>): Promise<PhotoLibraryPreviewOutcomeV1> => {
			calls.push(`${factory}:${photoId}:${tier}`); active++; maximumActive = Math.max(maximumActive, active);
			try {
				if (holdNext) { holdNext = false; heldSignal = options.signal; await new Promise<void>(resolve => { releaseHeld = resolve; }); }
				return Object.freeze({ outcome: 'ready', cache: 'hit', notices: Object.freeze([]),
					preview: Object.freeze({ photoId, tier, ...(tier === 'thumbnail' ? thumbnail : fitScreen) }) });
			} finally { active--; }
		}, [factory]);
		return <>
			<nav aria-label="View menu">
				<button onClick={() => { setThumbnails(value => !value); }}>{thumbnailsVisible ? 'Hide thumbnails' : 'Show thumbnails'}</button>
				<button onClick={() => { setLoupe(value => !value); }}>{loupe ? 'Hide loupe' : 'Show loupe'}</button>
				<button onClick={() => { setPage(value => value + 1); }}>Next page</button>
				<button onClick={() => { setFactory(value => value + 1); }}>Replace factory</button>
				<button onClick={() => { retainedCanvases = [...host.querySelectorAll('canvas')]; setMounted(false); }}>Close previews</button>
			</nav>
			{mounted && <PhotoPreviewPresentation readPreview={readPreview} photoIds={photoIds}
				thumbnailsVisible={thumbnailsVisible} fitScreenPhotoId={loupe ? photoIds[0]! : null}>
				{view => <>
					<output aria-label="Thumbnail backing bytes">{view.snapshot.thumbnailBytes}</output>
					<output aria-label="Loupe backing bytes">{view.snapshot.fitScreenBytes}</output>
					<output aria-label="Preview work">{view.snapshot.active ? 'working' : 'idle'}</output>
					<ul>{photoIds.map(id => <li key={id}>{view.renderThumbnail(id, `Thumbnail ${id}`)}</li>)}</ul>
					<figure>{view.renderLoupe(`Loupe ${photoIds[0]}`)}</figure>
				</>}
			</PhotoPreviewPresentation>}
		</>;
	}
	createRoot(host).render(<StrictMode><Harness /></StrictMode>);
}
