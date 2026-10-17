/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeHostJson } from './motion-ae-host-json.ts';
import type { MotionAeShapeProfileHost } from './motion-ae-host-shape-profile.ts';
export type MotionAeGaussianControl =
	| { readonly kind: 'group'; readonly matchName: string; readonly children: readonly MotionAeGaussianControl[] }
	| { readonly kind: 'scalar'; readonly matchName: string; readonly value: number; readonly minimum: number | null; readonly maximum: number | null };
export interface MotionAeGaussianProfile {
	readonly format: 'org.motionscaper.ae-gaussian-profile'; readonly version: 1; readonly qualification: 'unqualified'; readonly reviewed: true;
	readonly host: MotionAeShapeProfileHost;
	/** Explicitly reviewed labels on a newly owned sample; no popup integer implies these meanings. */
	readonly review: { readonly dimensions: 'both'; readonly repeatEdgePixels: false; readonly effectOpacity: 100; readonly effectMasks: 'none' };
	/** User-declared structural unit conversion, not a measured kernel/radius equivalence. */
	readonly blurrinessPerSigma: number; readonly blurrinessPath: readonly string[]; readonly effectOpacityPath: readonly string[];
	readonly controls: Extract<MotionAeGaussianControl, { kind: 'group' }>;
}
function record(input: unknown, allowed: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]') throw new Error('Gaussian profile requires a record.');
	const value = input as Record<string, unknown>; let count = 0;
	for (const key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
		if (++count > allowed.length) throw new Error('Gaussian profile field budget exceeded.');
		let known = false; for (let index = 0; index < allowed.length; index++) if (key === allowed[index]) known = true;
		if (!known) throw new Error('Gaussian profile has an unsupported field.');
	}
	if (count !== allowed.length) throw new Error('Gaussian profile is incomplete.'); return value;
}
function array(input: unknown, maximum: number): readonly unknown[] {
	if (Object.prototype.toString.call(input) !== '[object Array]' || (input as unknown[]).length > maximum) throw new Error('Gaussian profile array budget exceeded.'); return input as readonly unknown[];
}
function text(input: unknown, maximum: number): string {
	if (typeof input !== 'string' || !input.length || input.length > maximum || !/^[\x20-\x7e]+$/.test(input)) throw new Error('Gaussian profile text is invalid.'); return input;
}
function number(input: unknown, minimum: number, maximum: number): number {
	if (typeof input !== 'number' || !isFinite(input) || input < minimum || input > maximum) throw new Error('Gaussian profile numeric bound or scale is invalid.'); return input;
}
/** Bounded scalar/group snapshots keep every retained default, including neutral built-in compositing controls. */
export function normalizeMotionAeGaussianControls(input: unknown): MotionAeGaussianControl {
	let count = 0;
	function visit(input: unknown, depth: number): MotionAeGaussianControl {
		if (++count > 64 || depth > 4) throw new Error('Gaussian control depth/node budget exceeded.');
		if (!input || typeof input !== 'object') throw new Error('Gaussian control requires an object.');
		const kind: unknown = (input as Record<string, unknown>).kind;
		const value = record(input, kind === 'group' ? ['kind', 'matchName', 'children'] : ['kind', 'matchName', 'value', 'minimum', 'maximum']), matchName = text(value.matchName, 256);
		if (kind === 'group') {
			const raw = array(value.children, 32), children: MotionAeGaussianControl[] = [];
			for (let index = 0; index < raw.length; index++) {
				const child = visit(raw[index], depth + 1);
				for (let previous = 0; previous < children.length; previous++) if (children[previous]!.matchName === child.matchName) throw new Error('Gaussian control match names are duplicate or ambiguous.');
				children.push(child);
			}
			return { kind, matchName, children };
		}
		if (kind !== 'scalar') throw new Error('Gaussian profile control kind is unsupported.');
		const minimum = value.minimum === null ? null : number(value.minimum, -1e6, 1e6), maximum = value.maximum === null ? null : number(value.maximum, -1e6, 1e6);
		const scalar = number(value.value, -1e6, 1e6);
		if (minimum !== null && scalar < minimum || maximum !== null && scalar > maximum || minimum !== null && maximum !== null && minimum > maximum) throw new Error('Gaussian control value violates its captured bounds.');
		return { kind, matchName, value: scalar, minimum, maximum };
	}
	return visit(input, 0);
}
export function motionAeGaussianControl(root: MotionAeGaussianControl, path: readonly string[]): Extract<MotionAeGaussianControl, { kind: 'scalar' }> {
	if (!path.length || path.length > 4) throw new Error('Gaussian blurriness path budget is invalid.');
	let current: MotionAeGaussianControl = root;
	for (let index = 0; index < path.length; index++) {
		if (current.kind !== 'group') throw new Error('Gaussian blurriness path crosses a scalar control.');
		let found: MotionAeGaussianControl | null = null;
		for (let child = 0; child < current.children.length; child++) if (current.children[child]!.matchName === path[index]) found = current.children[child]!;
		if (!found) throw new Error('Gaussian blurriness path does not resolve.'); current = found;
	}
	if (current.kind !== 'scalar') throw new Error('Gaussian blurriness must select one scalar control.'); return current;
}
/** Normalize before serialization. Without expected host this validates inert custody only, never host admission. */
export function normalizeMotionAeGaussianProfile(input: unknown, expected?: MotionAeShapeProfileHost): MotionAeGaussianProfile {
	const r = record(input, ['format', 'version', 'qualification', 'reviewed', 'host', 'review', 'blurrinessPerSigma', 'blurrinessPath', 'effectOpacityPath', 'controls']);
	if (r.format !== 'org.motionscaper.ae-gaussian-profile' || r.version !== 1 || r.qualification !== 'unqualified' || r.reviewed !== true) throw new Error('Gaussian profile format or explicit unqualified review is missing.');
	const h = record(r.host, ['version', 'buildNumber', 'locale']), host = { version: text(h.version, 128), buildNumber: number(h.buildNumber, 0, 1e9), locale: text(h.locale, 128) };
	if (host.buildNumber !== Math.floor(host.buildNumber)) throw new Error('Gaussian profile host build is invalid.');
	if (expected && (host.version !== expected.version || host.buildNumber !== expected.buildNumber || host.locale !== expected.locale)) throw new Error('Gaussian profile belongs to a different host version, build or UI language. Calibrate this host or use complete rendered fallback.');
	const review = record(r.review, ['dimensions', 'repeatEdgePixels', 'effectOpacity', 'effectMasks']);
	if (review.dimensions !== 'both' || review.repeatEdgePixels !== false || review.effectOpacity !== 100 || review.effectMasks !== 'none') throw new Error('Gaussian profile requires reviewed Both Dimensions, Repeat Edge Pixels off, opacity 100 and no effect masks.');
	const rawPath = array(r.blurrinessPath, 4), blurrinessPath: string[] = [];
	for (let index = 0; index < rawPath.length; index++) blurrinessPath.push(text(rawPath[index], 256));
	const rawOpacityPath = array(r.effectOpacityPath, 4), effectOpacityPath: string[] = [];
	for (let index = 0; index < rawOpacityPath.length; index++) effectOpacityPath.push(text(rawOpacityPath[index], 256));
	const controls = normalizeMotionAeGaussianControls(r.controls);
	if (controls.kind !== 'group' || controls.matchName !== 'ADBE Gaussian Blur 2') throw new Error('Gaussian profile effect identity is unsupported.');
	const selected = motionAeGaussianControl(controls, blurrinessPath), opacity = motionAeGaussianControl(controls, effectOpacityPath);
	if (effectOpacityPath.length < 2 || opacity === selected || opacity.value !== 100 || opacity.minimum !== 0 || opacity.maximum !== 100) throw new Error('Gaussian profile must include the selected Effect Opacity control and its compositing group at 100 percent.');
	if (selected.value !== 0 || selected.minimum !== 0 || selected.maximum === null || selected.maximum <= 0) throw new Error('Gaussian profile requires zero neutral blurriness and known nonnegative control bounds.');
	return { format: 'org.motionscaper.ae-gaussian-profile', version: 1, qualification: 'unqualified', reviewed: true, host,
		review: { dimensions: 'both', repeatEdgePixels: false, effectOpacity: 100, effectMasks: 'none' }, blurrinessPerSigma: number(r.blurrinessPerSigma, 1e-6, 1e6), blurrinessPath, effectOpacityPath, controls };
}
export function parseMotionAeGaussianProfile(json: string, expected?: MotionAeShapeProfileHost): MotionAeGaussianProfile {
	if (json.length > 32768) throw new Error('Gaussian profile JSON budget exceeded.');
	return normalizeMotionAeGaussianProfile(parseMotionAeHostJson(json), expected);
}

/** Explicit local profile selection grants structural conversion authority, never visual equivalence. */
export interface MotionAeGaussianReview { readonly gaussianProfile?: MotionAeGaussianProfile }
