/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoGeneratorClipV1,
	normalizeVideoGeneratorSourceV1,
	normalizeVideoStillClipV1,
	normalizeVideoStillSourceV1,
	type VideoGeneratorDocumentV1,
	type VideoStillSourceV1,
} from './video-visual-model-v24.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from './unified-exact-render-visual-consumers-v13.ts';
import {
	evaluateVideoMaskMatteRgbaV13,
	type VideoMaskMatteRgbaInputV13,
} from './video-mask-matte-rgba-v13.ts';

export interface UnifiedExactRenderVisualRgbaV13 extends VideoMaskMatteRgbaInputV13 {}

export interface UnifiedExactRenderVisualMaterializerOptionsV13 {
	readonly targetWidth: number;
	readonly targetHeight: number;
	readonly decodeStill?: (source: VideoStillSourceV1) => Promise<UnifiedExactRenderVisualRgbaV13>;
	readonly maskInputs?: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>;
	readonly signal?: AbortSignal;
}

/** Materialize one exact active V13 still or built-in generator into straight RGBA. */
export async function materializeUnifiedExactRenderVisualEntryV13(
	entry: UnifiedExactRenderVisualFrameEntryV13,
	options: UnifiedExactRenderVisualMaterializerOptionsV13,
): Promise<UnifiedExactRenderVisualRgbaV13> {
	throwIfAborted(options?.signal);
	const width = dimension(options?.targetWidth, 'V13 visual target width');
	const height = dimension(options?.targetHeight, 'V13 visual target height');
	if (width * height > 33_554_432) throw new RangeError('A V13 visual frame may contain at most 33554432 pixels.');
	if (!entry || typeof entry !== 'object' || !('source' in entry.authoredState)) {
		throw new TypeError('A placed V13 visual entry is required.');
	}
	const state = entry.authoredState;
	let frame: UnifiedExactRenderVisualRgbaV13;
	if (entry.modelKind === 'still') {
		const source = normalizeVideoStillSourceV1(state.source);
		const clip = normalizeVideoStillClipV1(state.clip);
		if (source.id !== clip.sourceId || clip.id !== entry.modelId) {
			throw new ReferenceError('The V13 still entry has inconsistent identities.');
		}
		if (typeof options.decodeStill !== 'function') throw new Error('V13 still decode is unavailable.');
		frame = scaleFrame(await options.decodeStill(source), width, height, options.signal);
	} else {
		const source = normalizeVideoGeneratorSourceV1(state.source);
		const clip = normalizeVideoGeneratorClipV1(state.clip);
		if (source.id !== clip.sourceId || clip.id !== entry.modelId
			|| source.generator.kind !== entry.modelKind) {
			throw new ReferenceError('The V13 generator entry has inconsistent identities.');
		}
		if (source.generator.kind === 'external-generator') {
			throw new RangeError('External generators are unavailable in selected V13 execution.');
		}
		frame = generatorFrame(source.generator, width, height, options.signal);
	}
	if (entry.masks.length === 0) return frame;
	const pixels = frame.pixels.slice() as Uint8Array<ArrayBuffer>;
	for (const graph of entry.masks) {
		throwIfAborted(options.signal);
		const mask = evaluateVideoMaskMatteRgbaV13(
			graph, width, height, options.maskInputs ?? new Map(),
		);
		for (let index = 0; index < mask.length; index += 1) {
			pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3]! * mask[index]! / 255);
		}
	}
	return Object.freeze({ width, height, pixels });
}

function generatorFrame(
	document: Exclude<VideoGeneratorDocumentV1, Readonly<{ kind: 'external-generator' }>>,
	width: number,
	height: number,
	signal?: AbortSignal,
): UnifiedExactRenderVisualRgbaV13 {
	const pixels = new Uint8Array(width * height * 4);
	if (document.kind === 'solid') fillRect(pixels, width, height, 0, 0, width, height, color(document.color));
	else if (document.kind === 'shape') drawShape(pixels, width, height, document);
	else drawText(pixels, width, height, document, signal);
	return Object.freeze({ width, height, pixels });
}

function drawShape(
	pixels: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	document: Extract<VideoGeneratorDocumentV1, Readonly<{ kind: 'shape' }>>,
): void {
	const marginX = Math.max(1, Math.round(width / 8));
	const marginY = Math.max(1, Math.round(height / 8));
	const left = marginX;
	const top = marginY;
	const right = width - marginX;
	const bottom = height - marginY;
	const fill = document.fillColor === null ? null : color(document.fillColor);
	const stroke = document.strokeColor === null ? null : color(document.strokeColor);
	const strokeWidth = Math.max(1, Math.round(document.strokeWidth * width / 1_920));
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		let inside = false;
		let boundary = false;
		if (document.shape === 'rectangle') {
			inside = x >= left && x < right && y >= top && y < bottom;
			boundary = inside && (x < left + strokeWidth || x >= right - strokeWidth
				|| y < top + strokeWidth || y >= bottom - strokeWidth);
		} else if (document.shape === 'ellipse') {
			const dx = (x + 0.5 - (left + right) / 2) / ((right - left) / 2);
			const dy = (y + 0.5 - (top + bottom) / 2) / ((bottom - top) / 2);
			const distance = dx * dx + dy * dy;
			inside = distance <= 1;
			boundary = inside && distance >= Math.max(0, 1 - strokeWidth * 4 / Math.min(width, height));
		} else {
			const expected = top + (x - left) * (bottom - top) / Math.max(1, right - left);
			boundary = x >= left && x < right && Math.abs(y - expected) <= strokeWidth;
		}
		if (boundary && stroke) writePixel(pixels, width, x, y, stroke);
		else if (inside && fill) writePixel(pixels, width, x, y, fill);
	}
}

function drawText(
	pixels: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	document: Extract<VideoGeneratorDocumentV1, Readonly<{ kind: 'title' | 'text' }>>,
	signal?: AbortSignal,
): void {
	const characters = [...document.text];
	const cell = Math.max(1, Math.round(document.fontSize * Math.min(width / 1_920, height / 1_080) / 7));
	const glyphWidth = cell * 5;
	const advance = cell * 6;
	const lines = document.text.split('\n');
	const lineHeight = cell * 9;
	let characterOffset = 0;
	const totalHeight = lines.length * lineHeight - cell * 2;
	const originY = document.verticalAlign === 'start' ? cell * 2
		: document.verticalAlign === 'end' ? height - totalHeight - cell * 2
			: Math.round((height - totalHeight) / 2);
	const rgba = color(document.color);
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		throwIfAborted(signal);
		const line = [...lines[lineIndex]!];
		const lineWidth = Math.max(0, line.length * advance - cell);
		const originX = document.horizontalAlign === 'start' ? cell * 2
			: document.horizontalAlign === 'end' ? width - lineWidth - cell * 2
				: Math.round((width - lineWidth) / 2);
		for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
			const codePoint = line[characterIndex]!.codePointAt(0) ?? characters[characterOffset]?.codePointAt(0) ?? 0;
			drawGlyph(pixels, width, height, originX + characterIndex * advance,
				originY + lineIndex * lineHeight, glyphWidth, cell, codePoint, rgba, document.fontFamily);
			characterOffset += 1;
		}
		characterOffset += 1;
	}
}

function drawGlyph(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	left: number, top: number, glyphWidth: number, cell: number, codePoint: number,
	rgba: readonly [number, number, number, number], family: string,
): void {
	if (codePoint === 32) return;
	let seed = (codePoint ^ hashText(family) ^ 0x9e3779b9) >>> 0;
	for (let row = 0; row < 7; row += 1) {
		seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
		let bits = ((seed >>> 3) & 0x1f) | (row === 0 || row === 6 ? 0x11 : 0);
		if (row === 3) bits |= 0x04;
		for (let column = 0; column < 5; column += 1) {
			if ((bits & (1 << column)) === 0) continue;
			fillRect(pixels, width, height, left + column * cell, top + row * cell,
				Math.min(cell, glyphWidth - column * cell), cell, rgba);
		}
	}
}

function scaleFrame(
	frame: UnifiedExactRenderVisualRgbaV13,
	width: number,
	height: number,
	signal?: AbortSignal,
): UnifiedExactRenderVisualRgbaV13 {
	const sourceWidth = dimension(frame?.width, 'decoded still width');
	const sourceHeight = dimension(frame?.height, 'decoded still height');
	if (!(frame?.pixels instanceof Uint8Array)
		|| frame.pixels.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('Decoded still RGBA length does not match its dimensions.');
	}
	if (sourceWidth === width && sourceHeight === height) {
		return Object.freeze({ width, height, pixels: frame.pixels.slice() as Uint8Array<ArrayBuffer> });
	}
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		throwIfAborted(signal);
		const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
			const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
			pixels.set(frame.pixels.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
		}
	}
	return Object.freeze({ width, height, pixels });
}

function color(value: string): readonly [number, number, number, number] {
	if (!/^#[a-f0-9]{8}$/u.test(value)) throw new TypeError('V13 visual color must be canonical RGBA.');
	return Object.freeze([
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
		Number.parseInt(value.slice(7, 9), 16),
	]);
}

function fillRect(
	pixels: Uint8Array<ArrayBuffer>, width: number, height: number,
	left: number, top: number, rectangleWidth: number, rectangleHeight: number,
	rgba: readonly [number, number, number, number],
): void {
	const startX = Math.max(0, Math.floor(left));
	const startY = Math.max(0, Math.floor(top));
	const endX = Math.min(width, Math.ceil(left + rectangleWidth));
	const endY = Math.min(height, Math.ceil(top + rectangleHeight));
	for (let y = startY; y < endY; y += 1) for (let x = startX; x < endX; x += 1) {
		writePixel(pixels, width, x, y, rgba);
	}
}

function writePixel(
	pixels: Uint8Array<ArrayBuffer>, width: number, x: number, y: number,
	rgba: readonly [number, number, number, number],
): void {
	const offset = (y * width + x) * 4;
	pixels[offset] = rgba[0];
	pixels[offset + 1] = rgba[1];
	pixels[offset + 2] = rgba[2];
	pixels[offset + 3] = rgba[3];
}

function hashText(value: string): number {
	let hash = 2_166_136_261;
	for (const character of value) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619);
	return hash >>> 0;
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The visual render was aborted.', 'AbortError');
}
