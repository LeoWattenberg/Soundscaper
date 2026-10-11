/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionAeGaussianProfile, type MotionAeGaussianProfile, type MotionAeGaussianControl } from './motion-ae-gaussian-profile.ts';
import type { MotionAeImportNumeric } from './motion-ae-host-import-plan.ts';
export interface MotionAeImportGaussian { readonly enabled: boolean; readonly blur: MotionAeImportNumeric }
type Budget = { properties: number; keys: number };
type Numeric = (input: Record<string, unknown>, warnings: string[], budget: Budget) => MotionAeImportNumeric;
function object(input: unknown): Record<string, unknown> { if (!input || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]') throw new Error('Gaussian controls require objects.'); return input as Record<string, unknown>; }
function array(input: unknown, maximum: number): readonly unknown[] { if (Object.prototype.toString.call(input) !== '[object Array]' || (input as unknown[]).length > maximum) throw new Error('Gaussian control budget exceeded.'); return input as unknown[]; }
function same(path: readonly string[], other: readonly string[]): boolean { if (path.length !== other.length) return false; for (let index = 0; index < path.length; index++) if (path[index] !== other[index]) return false; return true; }
/** Admits exact closed Gaussian intent before the installed importer creates any object. */
export function readMotionAeImportGaussian(layer: Record<string, unknown>, inputProfile: MotionAeGaussianProfile | null, warnings: string[], budget: Budget, numeric: Numeric): readonly MotionAeImportGaussian[] {
	const profile = inputProfile ? normalizeMotionAeGaussianProfile(inputProfile) : null, roots = array(layer.properties, 65536), result: MotionAeImportGaussian[] = []; let found = false;
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
		const root = object(roots[rootIndex]); if (root.matchName !== 'ADBE Effect Parade') continue;
		if (found || root.kind !== 'group') throw new Error('Gaussian effect inventory is ambiguous.'); found = true;
		const children = array(root.children, 32);
		for (let index = 0; index < children.length; index++) {
			const effect = object(children[index]);
			if (!profile || effect.kind !== 'group' || effect.matchName !== 'ADBE Gaussian Blur 2') { warnings.push('An unmapped effect remains inert; choose a reviewed Gaussian profile or use complete rendered fallback.'); continue; }
			const compositing = object(layer.compositing);
			if (layer.threeD !== false || layer.adjustment !== false || compositing.preserveTransparency !== false || compositing.collapseTransformation !== false || typeof layer.effectsActive !== 'boolean' || typeof effect.enabled !== 'boolean') throw new Error('Gaussian effect requires captured neutral 2D layer switches.');
			let selected: MotionAeImportNumeric | null = null, count = 0;
			function visit(input: unknown, control: MotionAeGaussianControl, path: readonly string[]): void {
				if (++count > 64 || path.length > 4 || ++budget.properties > 65536) throw new Error('Gaussian import control budget exceeded.');
				const property = object(input); if (property.matchName !== control.matchName) throw new Error('Gaussian control closure changed.');
				if (control.kind === 'group') {
					if (property.kind !== 'group') throw new Error('Gaussian control group changed.'); const children = array(property.children, 32);
					if (children.length !== control.children.length) throw new Error('Gaussian control or effect-mask inventory changed.');
					for (let child = 0; child < children.length; child++) { const next = path.slice(); next.push(control.children[child]!.matchName); visit(children[child], control.children[child]!, next); } return;
				}
				if (property.kind !== 'numeric' || property.samples !== undefined || property.expression !== null && object(property.expression).enabled !== false) throw new Error('Gaussian expressions or samples are not admitted.');
				const value = numeric(property, warnings, budget), isBlur = same(path, profile!.blurrinessPath), maximum = isBlur ? Math.min(control.maximum!, 20 * profile!.blurrinessPerSigma) : control.value, minimum = isBlur ? 0 : control.value;
				function check(values: readonly number[]): void { if (values.length !== 1 || !isFinite(values[0]!) || values[0]! < minimum || values[0]! > maximum) throw new Error('Gaussian scalar exceeds reviewed bounds or neutral settings.'); }
				if (value.spatial || value.expression !== null || !isBlur && value.keys.length) throw new Error('Gaussian neutral controls must be static scalars.'); check(value.value);
				for (let key = 0; key < value.keys.length; key++) { const item = value.keys[key]!; check(item.value); if (item.inInterpolation !== 'hold' && item.inInterpolation !== 'linear' || item.outInterpolation !== 'hold' && item.outInterpolation !== 'linear' || item.roving || item.inSpatialTangent !== null || item.outSpatialTangent !== null) throw new Error('Gaussian admits only authored hold/linear scalar keys.'); }
				if (isBlur) selected = value;
			}
			visit(effect, profile.controls, []); const blur = selected as MotionAeImportNumeric | null; if (!blur) throw new Error('Gaussian selected blur control is missing.');
			result.push({ enabled: effect.enabled && layer.effectsActive, blur });
		}
	}
	if (result.length) warnings.push('Reviewed Gaussian controls use the declared scale only. Installed-host kernel, bounds, color and alpha parity remain unqualified. Compare complete rendered fallback.');
	return result;
}
