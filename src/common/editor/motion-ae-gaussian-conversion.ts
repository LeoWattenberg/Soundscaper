/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionEffect, MotionLayer } from './motion-composition.ts';
import type { MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
import { normalizeMotionAeGaussianProfile, motionAeGaussianControl, type MotionAeGaussianControl, type MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import { normalizeMotionAeProperties } from './motion-ae-property-custody.ts';
import { convertMotionAeNumericProperty } from './motion-ae-property-conversion.ts';
import { exportMotionAeNumeric } from './motion-ae-export-property.ts';
import type { Rational } from './timeline-time.ts';
type Group = Extract<MotionAeProperty, { kind: 'group' }>;
type Numeric = Extract<MotionAeProperty, { kind: 'numeric' }>;
const explanation = 'Editable Gaussian controls use only the reviewed declared unit scale. Installed AE kernel, bounds, color and alpha parity remain unqualified; complete rendered fallback is available. Original values remain in source custody.';
function failure(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function validateNumeric(property: Numeric, minimum: number, maximum: number): void {
	if (property.spatial || property.value.length !== 1 || property.samples || property.expression?.enabled) throw new Error('Gaussian blur requires an authored scalar without sampling or enabled expressions.');
	const check = (values: readonly number[]) => { if (values.length !== 1 || !Number.isFinite(values[0]) || values[0]! < minimum || values[0]! > maximum) throw new Error('Gaussian blur value exceeds reviewed host or Motion sigma bounds.'); };
	check(property.value);
	for (const key of property.keys) {
		if (key.roving || key.inSpatialTangent !== null || key.outSpatialTangent !== null || !['hold', 'linear'].includes(key.inInterpolation) || !['hold', 'linear'].includes(key.outInterpolation)) throw new Error('Gaussian blur admits only scalar hold/linear keys. Use complete rendered fallback.');
		check(key.value);
	}
}
function boundEffect(source: MotionAeProperty): void {
	let count = 0;
	function visit(property: MotionAeProperty, depth: number): void {
		if (++count > 64 || depth > 4) throw new Error('Gaussian source control budget exceeded.');
		if (property.kind === 'group') { if (property.children.length > 32) throw new Error('Gaussian source control budget exceeded.'); for (const child of property.children) visit(child, depth + 1); }
	}
	visit(source, 0);
}
/** The complete tree must match; only the selected blurriness scalar may vary. */
function readBlur(source: Group, profile: MotionAeGaussianProfile): Numeric {
	let selected: Numeric | null = null;
	function visit(property: MotionAeProperty, control: MotionAeGaussianControl, path: readonly string[]): void {
		if (property.matchName !== control.matchName) throw new Error('Gaussian control closure changed; use a profile captured for this exact host.');
		if (control.kind === 'group') {
			if (property.kind !== 'group' || property.children.length !== control.children.length) throw new Error('Gaussian control inventory or effect-mask references changed.');
			for (let index = 0; index < control.children.length; index++) visit(property.children[index]!, control.children[index]!, [...path, control.children[index]!.matchName]);
			return;
		}
		if (property.kind !== 'numeric') throw new Error('Gaussian profile requires scalar controls.');
		if (path.length === profile.blurrinessPath.length && path.every((name, index) => name === profile.blurrinessPath[index])) {
			validateNumeric(property, 0, Math.min(control.maximum!, 20 * profile.blurrinessPerSigma)); selected = property;
		} else {
			validateNumeric(property, control.value, control.value);
			if (property.keys.length) throw new Error('Gaussian channel/edge/compositing controls must remain at their static reviewed values.');
		}
	}
	visit(source, profile.controls, []); if (!selected) throw new Error('Gaussian blurriness control is missing.'); return selected;
}
export function convertMotionAeGaussianEffects(layer: MotionAeLayer, rate: Rational, inputProfile: MotionAeGaussianProfile | null, allocateId: () => string, report: MotionAeReportEntry[]): readonly MotionEffect[] {
	const profile = inputProfile ? normalizeMotionAeGaussianProfile(inputProfile) : null, result: MotionEffect[] = [];
	if (layer.properties.filter(property => property.matchName === 'ADBE Effect Parade').length > 1) { report.push({ scopeId: layer.id, propertyPath: 'ADBE Effect Parade', code: 'effect-mapping', status: 'unsupported', message: 'Duplicate effect inventories are ambiguous; retain the original and use complete rendered fallback.' }); return []; }
	for (const root of layer.properties) {
		if (root.matchName !== 'ADBE Effect Parade') continue;
		const issue = (propertyPath: string, message: string) => report.push({ scopeId: layer.id, propertyPath, code: 'effect-mapping', status: 'unsupported', message });
		if (root.kind !== 'group' || root.children.length > 32) { issue('ADBE Effect Parade', 'Effect inventory exceeds the bounded editable capability. Use complete rendered fallback.'); continue; }
		for (let index = 0; index < root.children.length; index++) {
			const source = root.children[index]!, location = `ADBE Effect Parade/${String(index)}:${source.matchName}`;
			try {
				if (!profile) throw new Error('Choose an explicitly reviewed Gaussian profile before editable effect conversion. Complete rendered fallback is available.');
				if (typeof layer.effectsActive !== 'boolean' || layer.threeD || layer.adjustment || layer.compositing?.preserveTransparency !== false || layer.compositing.collapseTransformation !== false) throw new Error('Gaussian mapping requires captured effect switches and neutral 2D layer compositing.');
				if (source.kind !== 'group' || source.matchName !== 'ADBE Gaussian Blur 2' || typeof source.enabled !== 'boolean') throw new Error('This effect or its captured enable switch is outside the reviewed Gaussian subset.');
				boundEffect(source);
				const normalized = normalizeMotionAeProperties([source], { properties: 0, keys: 0 })[0]!;
				if (normalized.kind !== 'group') throw new Error('Gaussian control group is unavailable.');
				const blur = readBlur(normalized, profile), converted = convertMotionAeNumericProperty(blur, { frameRate: rate, axes: [0], defaults: [0], scale: 1 / profile.blurrinessPerSigma });
				if (converted.property?.kind !== 'scalar' || converted.status !== 'editable') throw new Error(converted.message);
				result.push({ id: allocateId(), type: 'gaussian-blur', enabled: source.enabled && layer.effectsActive, parameters: [{ id: 'sigma', value: converted.property }] });
				report.push({ scopeId: layer.id, propertyPath: location, code: 'effect-mapping', status: 'editable', message: explanation });
				if (converted.quantizedClock) report.push({ scopeId: layer.id, propertyPath: location, code: 'clock-quantization', status: 'sampled', message: 'Gaussian key times were rounded to one millionth of a Motion frame. Exact AE times remain in custody.' });
			} catch (error) { issue(location, failure(error)); }
		}
	}
	return result;
}
export function exportMotionAeGaussianEffects(layer: MotionLayer, rate: Rational, inputProfile: MotionAeGaussianProfile | null, report: MotionAeReportEntry[]): readonly Group[] {
	const profile = inputProfile ? normalizeMotionAeGaussianProfile(inputProfile) : null, children: Group[] = [];
	if (layer.effects.length > 32) { report.push({ scopeId: layer.id, propertyPath: 'effects', code: 'effect-mapping', status: 'unsupported', message: 'Effect inventory exceeds the 32-effect editable budget. Use complete rendered fallback.' }); return []; }
	for (const effect of layer.effects) {
		const propertyPath = `effects/${effect.id}`;
		try {
			if (!profile) throw new Error('Choose an explicitly reviewed Gaussian profile before editable effect conversion. Complete rendered fallback is available.');
			if (layer.is3D || effect.type !== 'gaussian-blur' || effect.parameters.length !== 1 || effect.parameters[0]!.id !== 'sigma') throw new Error('This layer, effect or parameter inventory is outside the reviewed Gaussian subset.');
			const sigma = effect.parameters[0]!.value;
			if (sigma.kind !== 'scalar' || sigma.expression?.enabled || sigma.curve?.segments.some(segment => segment.kind !== 'hold' && segment.kind !== 'linear')) throw new Error('Gaussian sigma requires an authored scalar with hold/linear keys and no enabled expressions.');
			const control = motionAeGaussianControl(profile.controls, profile.blurrinessPath), maximum = Math.min(control.maximum!, 20 * profile.blurrinessPerSigma);
			const exported = exportMotionAeNumeric(sigma, { matchName: control.matchName, name: 'Blurriness', axes: [0], scale: profile.blurrinessPerSigma, spatial: false, rate: rate.num / rate.den, startFrame: layer.startFrame });
			if (exported.unsupported) throw new Error(exported.unsupported); validateNumeric(exported.property, 0, maximum);
			function build(control: MotionAeGaussianControl, path: readonly string[]): MotionAeProperty {
				if (control.kind === 'group') return { kind: 'group', name: control.matchName, matchName: control.matchName, children: control.children.map(child => build(child, [...path, child.matchName])) };
				if (path.length === profile!.blurrinessPath.length && path.every((name, index) => name === profile!.blurrinessPath[index])) return exported.property;
				return { kind: 'numeric', name: control.matchName, matchName: control.matchName, value: [control.value], keys: [], spatial: false, expression: null };
			}
			const group = build(profile.controls, []); if (group.kind !== 'group') throw new Error('Gaussian profile root is invalid.');
			children.push({ ...group, name: effect.id, enabled: effect.enabled }); report.push({ scopeId: layer.id, propertyPath, code: 'effect-mapping', status: 'editable', message: explanation });
		} catch (error) { report.push({ scopeId: layer.id, propertyPath, code: 'effect-mapping', status: 'unsupported', message: failure(error) }); }
	}
	return children.length ? [{ kind: 'group', name: 'Effects', matchName: 'ADBE Effect Parade', children }] : [];
}
