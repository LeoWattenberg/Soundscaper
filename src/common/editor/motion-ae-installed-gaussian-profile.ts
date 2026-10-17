/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeGaussianProfile, type MotionAeGaussianProfile } from './motion-ae-gaussian-profile.ts';
import { prepareMotionAeGaussianCalibration, captureMotionAeGaussianCalibration, MOTION_AE_GAUSSIAN_REVIEW, type MotionAeGaussianSample, type MotionAeGaussianCalibrationHost } from './motion-ae-gaussian-calibration.ts';
import type { MotionAeGaussianHostControl } from './motion-ae-gaussian-host-controls.ts';
import { stringifyMotionAeHostJson } from './motion-ae-host-json.ts';
interface AeFile { readonly exists: boolean; readonly alias: boolean; readonly length: number; encoding: string; open(mode: string): boolean; read(): string; write(value: string): boolean; close(): boolean; remove(): boolean }
interface SelectedProperty { readonly matchName: string; readonly propertyIndex: number; readonly parentProperty: SelectedProperty | null }
interface Sample extends MotionAeGaussianSample { readonly selectedProperties: readonly SelectedProperty[] }
declare const app: { readonly version: string; readonly buildNumber: number; readonly isoLanguage: string;
	readonly project: { readonly activeItem: Sample | null; readonly items: { addComp(name: string, width: number, height: number, aspect: number, duration: number, frameRate: number): Sample } } | null;
	beginUndoGroup(name: string): void; endUndoGroup(): void };
declare const CompItem: { new(): Sample };
declare const PropertyType: { PROPERTY: unknown };
declare const PropertyValueType: { OneD: unknown };
declare const File: { openDialog(message: string): AeFile | null; saveDialog(message: string): AeFile | null };
declare function confirm(message: string): boolean;
declare function prompt(message: string, initial?: string): string | null;
declare function alert(message: string): void;
function identity() { return { version: app.version, buildNumber: app.buildNumber, locale: app.isoLanguage }; }
export function motionAeInstalledGaussianKind(value: MotionAeGaussianHostControl): 'group' | 'scalar' | 'unsupported' {
	const property = value as MotionAeGaussianHostControl & { readonly propertyType: unknown; readonly propertyValueType: unknown };
	return property.propertyType !== PropertyType.PROPERTY ? 'group' : property.propertyValueType === PropertyValueType.OneD ? 'scalar' : 'unsupported';
}
export function chooseMotionAeGaussianProfile(): MotionAeGaussianProfile | null {
	const file = File.openDialog('Choose your reviewed Gaussian profile for this exact AE version, build and language. Cancel to stop and use complete rendered fallback.'); if (!file) return null;
	if (!file.exists || file.alias || file.length > 32768) throw new Error('Gaussian profile is missing, aliased or exceeds its byte budget.');
	file.encoding = 'UTF-8'; if (!file.open('r')) throw new Error('Cannot read Gaussian profile.'); let text: string;
	try { text = file.read(); } catch (error) {
		let cleanup = ''; try { if (!file.close()) cleanup = 'close failed'; } catch (failure) { cleanup = String(failure); }
		if (cleanup) { const failure = new Error('Gaussian profile read failed: ' + String(error) + '; cleanup: ' + cleanup, { cause: error }); failure.cause = error; throw failure; } throw error;
	}
	if (!file.close()) throw new Error('Cannot close Gaussian profile.'); return parseMotionAeGaussianProfile(text, identity());
}
function selectedPaths(sample: MotionAeGaussianSample): readonly (readonly string[])[] {
	const selected = (sample as Sample).selectedProperties, paths: string[][] = [];
	if (selected.length !== 2) throw new Error('Select exactly the Blurriness and Effect Opacity properties.');
	for (let index = 0; index < selected.length; index++) {
		let item: SelectedProperty | null = selected[index]!; const path: string[] = [];
		while (item && item.matchName !== 'ADBE Gaussian Blur 2') { if (path.length >= 4) throw new Error('Selected Gaussian control path exceeds its budget.'); path.unshift(item.matchName); item = item.parentProperty; }
		if (!item || item.propertyIndex !== 1 || item.parentProperty?.matchName !== 'ADBE Effect Parade') throw new Error('Selected control is outside the sole reviewed Gaussian effect.');
		paths.push(path);
	}
	return paths;
}
/** Explicit prepare/capture entry; source export never creates calibration objects. */
export function runMotionAeGaussianCalibration(): void {
	try {
		const project = app.project; if (!project) throw new Error('Open an AE project first.');
		const action = prompt('Enter prepare to create a new owned Gaussian review sample, or capture after reviewing that sample. Existing project items and files are never saved or overwritten.', 'prepare');
		if (action === null) return; if (action !== 'prepare' && action !== 'capture') throw new Error('Choose prepare or capture.');
		const host: MotionAeGaussianCalibrationHost = { identity: identity(), begin: () => app.beginUndoGroup('Motionscaper Gaussian review'), end: () => app.endUndoGroup(),
			create: () => project.items.addComp('Motionscaper Gaussian Review', 512, 512, 1, 1, 24), kind: motionAeInstalledGaussianKind, selection: selectedPaths };
		if (action === 'prepare') { if (!confirm(MOTION_AE_GAUSSIAN_REVIEW + '\n\nCreate the new owned sample?')) return; prepareMotionAeGaussianCalibration(host); alert(MOTION_AE_GAUSSIAN_REVIEW); return; }
		const sample = project.activeItem; if (!(sample instanceof CompItem)) throw new Error('Select the newly owned Gaussian review composition.');
		if (!confirm(MOTION_AE_GAUSSIAN_REVIEW + '\n\nHave you personally reviewed every named UI label?')) return;
		const scale = prompt('Enter your own finite positive blurriness-per-Motion-sigma scale. No default or kernel equivalence is inferred. Installed AE parity remains unqualified.', ''); if (scale === null) return;
		if (!/^\s*(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\s*$/.test(scale)) throw new Error('A positive numeric declared scale is required.');
		const profile = captureMotionAeGaussianCalibration(sample, host, true, Number(scale)), text = stringifyMotionAeHostJson(profile);
		const file = File.saveDialog('Save a NEW Motionscaper Gaussian profile JSON file. Existing files are refused.'); if (!file) return;
		if (file.exists || file.alias) throw new Error('Choose a new non-aliased profile file.'); file.encoding = 'UTF-8'; if (!file.open('w')) throw new Error('Cannot create Gaussian profile.'); let closed = false;
		try { if (!file.write(text)) throw new Error('Cannot write Gaussian profile.'); if (!file.close()) throw new Error('Cannot close Gaussian profile.'); closed = true; }
		catch (error) {
			const failures: string[] = [];
			if (!closed) try { if (!file.close()) failures.push('close failed'); } catch (cleanup) { failures.push(String(cleanup)); }
			try { if (!file.remove()) failures.push('new file removal failed'); } catch (cleanup) { failures.push(String(cleanup)); }
			const failure = new Error('Gaussian profile write failed: ' + String(error) + (failures.length ? '; cleanup: ' + failures.join('; ') : ''), { cause: error }); failure.cause = error; throw failure;
		}
		alert('Reviewed Gaussian profile saved for this exact host. Installed AE kernel, bounds, color and alpha parity remain unqualified. Complete rendered fallback is available. No project was saved.');
	} catch (error) { alert('Motionscaper Gaussian review did not complete: ' + String(error)); }
}
