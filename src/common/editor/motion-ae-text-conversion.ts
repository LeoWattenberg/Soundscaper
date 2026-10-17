/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty } from './motion-ae-exchange-types.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { normalizeMotionAeFontBindings, type MotionAeFontBinding } from './motion-ae-text-fonts.ts';
import type { MotionTextDocument } from './motion-composition.ts';
import { normalizeMotionLayerContent } from './motion-layer-content.ts';
import { motionColor, motionScalar, motionVector, type MotionProperty } from './motion-property.ts';
import { decodeMotionChannel, encodeMotionChannel } from './motion-surface.ts';
import { freezeMotionValue, motionEnum, motionNumber, motionRecord } from './motion-values.ts';

type TextProperty = Extract<MotionAeProperty, { kind: 'text' }>;
export interface MotionAeTextMessage { readonly status: 'editable' | 'unsupported'; readonly code: string; readonly message: string }
interface ReflowOptions {
	/** The caller must expose this policy in conversion review; no matching line layout is implied. */
	readonly layoutPolicy: 'review-reflow'; readonly colorSpace: 'linear-rec709-d65' | 'srgb';
}
export interface MotionAeTextImportOptions extends ReflowOptions { readonly lineHeight: number }
export interface MotionAeTextExportOptions extends ReflowOptions { readonly leading: number }
export interface MotionAeTextImportResult {
	readonly status: 'editable' | 'unsupported'; readonly document: MotionTextDocument | null;
	/** Add this local source offset in the caller's explicit geometry conversion; never add directly to world position. */
	readonly localOffset: readonly [number, number] | null; readonly messages: readonly MotionAeTextMessage[];
}
export interface MotionAeTextExportResult {
	readonly status: 'editable' | 'unsupported'; readonly property: TextProperty | null; readonly messages: readonly MotionAeTextMessage[];
}
const layoutMessage: MotionAeTextMessage = { status: 'unsupported', code: 'text-layout-reflow', message:
	'Text is reflowed using the reviewed destination line spacing. AE leading, baselines, kerning, shaping, wrapping and clipping are not pixel-equivalent to Motion. Compare a rendered reference; original text settings remain in custody.' };
const fontMessage: MotionAeTextMessage = { status: 'editable', code: 'text-font-binding', message:
	'The explicit PostScript-name binding selects a retained font descriptor. The same installed AE face must be verified separately; font-family names and system substitution are not used.' };
function readOptions(input: ReflowOptions, field: 'lineHeight' | 'leading'): ReflowOptions & { readonly spacing: number } {
	const r = motionRecord(input, ['layoutPolicy', 'colorSpace', field], 'AE text mapping options');
	return { layoutPolicy: motionEnum(r.layoutPolicy, ['review-reflow'], 'AE text layout policy'),
		colorSpace: motionEnum(r.colorSpace, ['linear-rec709-d65', 'srgb'], 'AE text color space'),
		spacing: motionNumber(r[field], field === 'lineHeight' ? 'Motion line height' : 'AE leading', 0.01, field === 'lineHeight' ? 100 : 1e6) };
}
function unavailable(message: string): readonly MotionAeTextMessage[] { return [{ status: 'unsupported', code: 'text-mapping', message }]; }
function normalizedText(document: MotionTextDocument): MotionTextDocument {
	const content = normalizeMotionLayerContent({ kind: 'text', document });
	if (content.kind !== 'text') throw new TypeError('Expected a Motion text document.'); return content.document;
}
/** Uniformity must come from full-range capture. Adobe TextDocument font/style values can describe only the first character:
 * https://developer.adobe.com/after-effects/uxp/after-effects-api/textdocument
 */
export function convertMotionAeTextDocument(input: TextProperty, fontBindings: readonly MotionAeFontBinding[], options: MotionAeTextImportOptions): MotionAeTextImportResult {
	const selected = readOptions(options, 'lineHeight'), bindings = normalizeMotionAeFontBindings(fontBindings);
	const property = normalizeMotionAeProperties([input], { properties: 0, keys: 0 })[0]!;
	if (property.kind !== 'text') throw new TypeError('AE text conversion requires Source Text custody.');
	const fail = (message: string): MotionAeTextImportResult => freezeMotionValue({ status: 'unsupported', document: null, localOffset: null, messages: unavailable(message) });
	if (property.keys.length || property.expression?.enabled) return fail('Animated or expression-driven Source Text requires an AE-rendered fallback; expression source stays inert.');
	const source = property.value, layout = source.layout;
	if (source.styleScope !== 'uniform' || source.styleSupport !== 'basic') return fail('Full-range uniform basic character and paragraph style capture is required. Missing, mixed or unsupported style metadata remains in original custody.');
	if (layout?.kind !== 'box' || layout.orientation !== 'horizontal') return fail('Only captured horizontal paragraph boxes map to editable text. Point and vertical text require a separate geometry policy or rendered fallback.');
	if (!source.applyFill || source.applyStroke) return fail('Only fill-only text maps to the current Motion document; stroke and stroke-only appearance require rendered fallback.');
	const font = bindings.find(binding => binding.postScriptName === source.font);
	if (!font) return fail(`No explicit retained-font binding exists for PostScript face “${source.font}”. Import that face and bind it before conversion.`);
	const tracking = source.tracking * source.fontSize / 1000;
	if (source.text.length > 65_536 || source.text.normalize('NFC') !== source.text || source.fontSize < 1 || source.fontSize > 4096 || Math.abs(tracking) > 32768 || layout.size.some(value => value > 32768)) return fail('This text exceeds the canonical Motion document or rendering limits; original text is retained without truncation.');
	const text = source.text.replace(/\r\n?/gu, '\n'), color = source.fillColor.map(value => selected.colorSpace === 'srgb' ? decodeMotionChannel(value, 'srgb') : value);
	const document = normalizedText({ runs: [{ text, fontAssetId: font.asset.id, fontSize: motionScalar(source.fontSize), tracking: motionScalar(tracking), color: motionColor([color[0]!, color[1]!, color[2]!, 1]) }],
		align: source.justification, lineHeight: motionScalar(selected.spacing), boxSize: motionVector(layout.size) });
	const messages = [fontMessage, layoutMessage];
	if (text !== source.text) messages.push({ status: 'editable', code: 'text-newlines', message: 'AE paragraph carriage returns became Motion line feeds; original source text remains in custody.' });
	return freezeMotionValue({ status: 'editable', document, localOffset: layout.position, messages });
}
function dynamic(property: MotionProperty): boolean {
	return Boolean(property.expression?.enabled || (property.kind === 'scalar' ? property.curve : property.kind === 'path' ? property.keyframes.length : property.curves.some(Boolean)));
}
export function exportMotionAeTextDocument(input: MotionTextDocument, fontBindings: readonly MotionAeFontBinding[], options: MotionAeTextExportOptions): MotionAeTextExportResult {
	const selected = readOptions(options, 'leading'), bindings = normalizeMotionAeFontBindings(fontBindings), document = normalizedText(input);
	const fail = (message: string): MotionAeTextExportResult => freezeMotionValue({ status: 'unsupported', property: null, messages: unavailable(message) });
	if (document.animators?.some(animator => animator.enabled) || dynamic(document.lineHeight) || dynamic(document.boxSize) || document.runs.some(run => dynamic(run.fontSize) || dynamic(run.color) || dynamic(run.tracking))) return fail('Text animators, curves and enabled expressions require rendered fallback; static conversion never samples or drops them.');
	const first = document.runs[0]!;
	if (document.runs.some(run => run.fontAssetId !== first.fontAssetId || run.fontSize.value !== first.fontSize.value || run.tracking.value !== first.tracking.value || run.color.value.some((value, index) => value !== first.color.value[index]))) return fail('Mixed styled runs require explicit per-run AE conversion; this uniform text path never flattens distinct styles.');
	if (first.color.value[3] !== 1 || document.align === 'justify') return fail('Translucent text fill and full justification require a separate explicit AE mapping.');
	if (first.fontSize.value < 1 || first.fontSize.value > 1296 || Math.abs(first.tracking.value) > 32768 || document.boxSize.value.some(value => value < 1 || value > 32768)
		|| document.lineHeight.value <= 0 || document.lineHeight.value > 100) return fail('The text size, box or spacing exceeds the bounded AE/Motion editable range.');
	const font = bindings.find(binding => binding.asset.id === first.fontAssetId);
	if (!font) return fail(`No explicit PostScript binding exists for retained font “${first.fontAssetId}”. Family-name substitution is refused.`);
	const color = first.color.value.slice(0, 3).map(value => selected.colorSpace === 'srgb' ? encodeMotionChannel(value, 'srgb') : value);
	const text = document.runs.map(run => run.text).join('').replace(/\r\n?|\n/gu, '\r');
	const property: TextProperty = { kind: 'text', matchName: 'ADBE Text Document', name: 'Source Text', keys: [], expression: null, value: {
		text, font: font.postScriptName, fontSize: first.fontSize.value, fillColor: [color[0]!, color[1]!, color[2]!], applyFill: true, applyStroke: false,
		strokeColor: [0, 0, 0], strokeWidth: 0, tracking: first.tracking.value * 1000 / first.fontSize.value, leading: selected.spacing, autoLeading: false,
		justification: document.align, styleScope: 'uniform', styleSupport: 'basic', layout: { kind: 'box', orientation: 'horizontal', size: document.boxSize.value, position: [0, 0] },
	} };
	// Validate our new custody fields with the same boundary consumed by the installed-host bridge.
	const normalized = normalizeMotionAeProperties([property], { properties: 0, keys: 0 })[0];
	if (normalized?.kind !== 'text') throw new TypeError('Expected exported AE text.');
	return freezeMotionValue({ status: 'editable', property: normalized, messages: [fontMessage, layoutMessage] });
}
