/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CanvasKit, Paragraph, ShapedLine } from 'canvaskit-wasm';
import type { MotionTextDocument } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { freezeMotionValue } from './motion-values.ts';
import { createMotionFontProviderOwner, type MotionFontBytes, type MotionFontProviderOwner } from './motion-canvaskit-font-owner.ts';
export type { MotionFontBytes } from './motion-canvaskit-font-owner.ts';

export interface MotionShapedText {
	readonly width: number; readonly height: number; readonly unresolvedCodepoints: readonly number[];
	readonly lines: readonly { readonly first: number; readonly last: number; readonly top: number; readonly bottom: number; readonly baseline: number;
		readonly runs: readonly { readonly glyphs: readonly number[]; readonly positions: readonly number[]; readonly clusters: readonly number[]; readonly size: number }[] }[];
}
export interface MotionParagraph { readonly paragraph: Paragraph; readonly metrics: MotionShapedText; readonly shapedLines: readonly ShapedLine[]; dispose(): void }

/** Only explicitly supplied font bytes enter this provider; no host/system font discovery. */
export function createMotionParagraph(kit: CanvasKit, document: EvaluatedMotionState<MotionTextDocument>, fonts: readonly MotionFontBytes[], fallbacks: readonly MotionFontBytes[], fontProviders?: MotionFontProviderOwner): MotionParagraph {
	if (document.boxSize.some((value) => !Number.isFinite(value) || value <= 0 || value > 32768) || !Number.isFinite(document.lineHeight) || document.lineHeight <= 0 || document.lineHeight > 100) throw new RangeError('Motion text box/line height is outside the rendering range.');
	const owner = fontProviders ?? createMotionFontProviderOwner(kit, { maximumProviders: 1 });
	const lease = owner.acquire(kit, fonts, fallbacks), provider = lease.provider;
	const release = () => { lease.release(); if (!fontProviders) owner.dispose(); };
	let paragraph: Paragraph | null = null;
	let shapedLines: readonly ShapedLine[] = [];
	try {
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
		shapedLines = paragraph.getShapedLines();
		const metrics: MotionShapedText = freezeMotionValue({ width: paragraph.getLongestLine(), height: paragraph.getHeight(), unresolvedCodepoints,
			lines: shapedLines.map((line) => ({ first: line.textRange.first, last: line.textRange.last, top: line.top, bottom: line.bottom, baseline: line.baseline,
				runs: line.runs.map((run) => ({ glyphs: Array.from(run.glyphs), positions: Array.from(run.positions), clusters: Array.from(run.offsets), size: run.size })) })) });
		const retained = paragraph;
		let disposed = false;
		return { paragraph: retained, metrics, shapedLines, dispose() { if (!disposed) { disposed = true; for (const line of shapedLines) for (const run of line.runs) run.typeface?.delete(); retained.delete(); release(); } } };
	} catch (error) { for (const line of shapedLines) for (const run of line.runs) run.typeface?.delete(); paragraph?.delete(); release(); throw error; }
}
