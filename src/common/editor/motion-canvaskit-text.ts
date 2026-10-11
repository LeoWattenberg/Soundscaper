/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CanvasKit, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm';
import type { MotionTextDocument } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { freezeMotionValue } from './motion-values.ts';

export interface MotionFontBytes { readonly id: string; readonly bytes: Uint8Array }
export interface MotionShapedText {
	readonly width: number; readonly height: number; readonly unresolvedCodepoints: readonly number[];
	readonly lines: readonly { readonly first: number; readonly last: number; readonly top: number; readonly bottom: number; readonly baseline: number;
		readonly runs: readonly { readonly glyphs: readonly number[]; readonly positions: readonly number[]; readonly clusters: readonly number[]; readonly size: number }[] }[];
}
export interface MotionParagraph { readonly paragraph: Paragraph; readonly metrics: MotionShapedText; dispose(): void }

/** Only explicitly supplied font bytes enter this provider; no host/system font discovery. */
export function createMotionParagraph(kit: CanvasKit, document: EvaluatedMotionState<MotionTextDocument>, fonts: readonly MotionFontBytes[], fallbacks: readonly MotionFontBytes[]): MotionParagraph {
	if (document.boxSize.some((value) => !Number.isFinite(value) || value <= 0 || value > 32768) || !Number.isFinite(document.lineHeight) || document.lineHeight <= 0 || document.lineHeight > 100) throw new RangeError('Motion text box/line height is outside the rendering range.');
	const provider = kit.TypefaceFontProvider.Make();
	let paragraph: Paragraph | null = null;
	try {
		if ([...fonts, ...fallbacks].reduce((total, font) => total + font.bytes.length, 0) > 64 * 1024 * 1024) throw new RangeError('Motion paragraph exceeds the 64 MiB font budget.');
		for (const font of [...fonts, ...fallbacks]) registerFont(kit, provider, font);
		const align = { left: kit.TextAlign.Left, center: kit.TextAlign.Center, right: kit.TextAlign.Right, justify: kit.TextAlign.Justify }[document.align];
		const style = new kit.ParagraphStyle({ textAlign: align, disableHinting: true, applyRoundingHack: false, heightMultiplier: document.lineHeight,
			textStyle: { fontFamilies: fonts.map((font) => font.id), fontSize: 24 } });
		const builder = kit.ParagraphBuilder.MakeFromFontProvider(style, provider);
		try {
			for (const run of document.runs) {
				if (!Number.isFinite(run.fontSize) || run.fontSize <= 0 || run.fontSize > 4096 || !Number.isFinite(run.tracking) || Math.abs(run.tracking) > 32768) throw new RangeError('Motion text size/tracking is outside the rendering range.');
				builder.pushStyle(new kit.TextStyle({ fontFamilies: [run.fontAssetId, ...fallbacks.map((font) => font.id)], fontSize: run.fontSize,
					color: kit.Color4f(...run.color), letterSpacing: run.tracking, heightMultiplier: document.lineHeight }));
				builder.addText(run.text); builder.pop();
			}
			paragraph = builder.build();
		} finally { builder.delete(); }
		paragraph.layout(document.boxSize[0]);
		const unresolvedCodepoints = paragraph.unresolvedCodepoints();
		if (unresolvedCodepoints.length > 0) throw new Error(`Motion text has missing glyphs ${unresolvedCodepoints.map((point) => `U+${point.toString(16).toUpperCase()}`).join(', ')}; import a font containing those characters.`);
		const metrics: MotionShapedText = freezeMotionValue({ width: paragraph.getLongestLine(), height: paragraph.getHeight(), unresolvedCodepoints,
			lines: paragraph.getShapedLines().map((line) => ({ first: line.textRange.first, last: line.textRange.last, top: line.top, bottom: line.bottom, baseline: line.baseline,
				runs: line.runs.map((run) => ({ glyphs: Array.from(run.glyphs), positions: Array.from(run.positions), clusters: Array.from(run.offsets), size: run.size })) })) });
		const retained = paragraph;
		let disposed = false;
		return { paragraph: retained, metrics, dispose() { if (!disposed) { disposed = true; retained.delete(); provider.delete(); } } };
	} catch (error) { paragraph?.delete(); provider.delete(); throw error; }
}

function registerFont(kit: CanvasKit, provider: TypefaceFontProvider, font: MotionFontBytes): void {
	if (font.bytes.length > 64 * 1024 * 1024) throw new RangeError(`Motion font ${font.id} exceeds the 64 MiB font budget.`);
	const face = kit.Typeface.MakeFreeTypeFaceFromData(new Uint8Array(font.bytes).buffer);
	if (!face) throw new Error(`Motion font ${font.id} is not a supported font file.`);
	face.delete();
	provider.registerFont(font.bytes, font.id);
}
