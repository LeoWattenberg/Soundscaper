/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseMotionAeShapeProfile, type MotionAeShapeProfile, type MotionAeShapeProfileHost } from './motion-ae-host-shape-profile.ts';
import { prepareMotionAeShapeCalibration, captureMotionAeShapeCalibration, MOTION_AE_SHAPE_REVIEW, type MotionAeCalibrationComposition } from './motion-ae-host-shape-calibration.ts';
import { stringifyMotionAeHostJson } from './motion-ae-host-json.ts';
interface AeFile {
	readonly exists: boolean; readonly length: number; readonly alias: boolean; readonly fsName: string; encoding: string;
	open(mode: string): boolean; read(): string; write(text: string): boolean; close(): boolean; remove(): boolean;
}
declare const app: { readonly version: string; readonly buildNumber: number; readonly isoLanguage: string;
	readonly project: { readonly activeItem: MotionAeCalibrationComposition | null; readonly items: { addComp(name: string, width: number, height: number, aspect: number, duration: number, frameRate: number): MotionAeCalibrationComposition } } | null;
	beginUndoGroup(name: string): void; endUndoGroup(): void };
declare const CompItem: { new(): MotionAeCalibrationComposition };
declare const File: { openDialog(prompt: string): AeFile | null; saveDialog(prompt: string): AeFile | null };
declare const Shape: { new(): { closed: boolean; vertices: number[][]; inTangents: number[][]; outTangents: number[][] } };
declare function confirm(message: string): boolean;
declare function alert(message: string): void;
function identity(): MotionAeShapeProfileHost { return { version: app.version, buildNumber: app.buildNumber, locale: app.isoLanguage }; }
/** Optional, read-only selection. A cancelled chooser grants no mapping authority. */
export function chooseMotionAeShapeProfile(): MotionAeShapeProfile | null {
	const file = File.openDialog('Choose your reviewed shape-style profile for this exact AE version, build and language. Cancel to stop and use rendered fallback.'); if (!file) return null;
	if (!file.exists || file.alias || file.length > 8192) throw new Error('Shape profile is missing, aliased or exceeds its byte budget.');
	file.encoding = 'UTF-8'; if (!file.open('r')) throw new Error('Cannot read shape profile.'); let text: string;
	try { text = file.read(); } catch (error) { if (!file.close()) { const failure = new Error('Shape profile read failed: ' + String(error) + '; close also failed.', { cause: error }); failure.cause = error; throw failure; } throw error; }
	if (!file.close()) throw new Error('Cannot close shape profile.'); return parseMotionAeShapeProfile(text, identity());
}
export function runMotionAeShapeCalibration(capture = false): void {
	try {
		const project = app.project; if (!project) throw new Error('Open an AE project first. Calibration adds only its own sample composition.');
		if (!capture) {
			if (!confirm('Create one new sample composition for manual shape-style label review? Existing items and files are not changed or saved.\n\n' + MOTION_AE_SHAPE_REVIEW)) return;
			prepareMotionAeShapeCalibration({ identity: identity(), begin: () => app.beginUndoGroup('Prepare Motionscaper shape style review'), end: () => app.endUndoGroup(),
				create: () => project.items.addComp('Motionscaper Shape Style Review', 512, 512, 1, 1, 24), shape: () => {
					const shape = new Shape(); shape.closed = true; shape.vertices = [[32, 32], [160, 32], [96, 160]]; shape.inTangents = [[0, 0], [0, 0], [0, 0]]; shape.outTangents = [[0, 0], [0, 0], [0, 0]]; return shape;
				} }); alert(MOTION_AE_SHAPE_REVIEW); return;
		}
		const comp = project.activeItem; if (!(comp instanceof CompItem)) throw new Error('Select the prepared calibration composition first.');
		if (!confirm(MOTION_AE_SHAPE_REVIEW + '\n\nHave you personally reviewed every named UI label and both path directions?')) return;
		const profile = captureMotionAeShapeCalibration(comp, identity(), true), text = stringifyMotionAeHostJson(profile);
		const file = File.saveDialog('Save a NEW Motionscaper shape-style profile JSON file. Existing files are refused.'); if (!file) return;
		if (file.exists || file.alias) throw new Error('Choose a new non-aliased profile file; existing files are never overwritten.');
		file.encoding = 'UTF-8'; if (!file.open('w')) throw new Error('Cannot create shape profile file.'); let closed = false;
		try { if (!file.write(text)) throw new Error('Cannot write shape profile.'); if (!file.close()) throw new Error('Cannot close shape profile.'); closed = true; }
		catch (error) { const failures: string[] = []; if (!closed && !file.close()) failures.push('close failed'); if (!file.remove()) failures.push('new file removal failed'); const failure = new Error('Shape profile write failed: ' + String(error) + (failures.length ? '; cleanup: ' + failures.join('; ') : ''), { cause: error }); failure.cause = error; throw failure; }
		alert('Reviewed shape-style profile saved. Select it only for this exact AE version/build/language. It is user calibration, not installed-AE visual qualification. The sample composition remains available for review; no project was saved.');
	} catch (error) { alert('Motionscaper shape calibration did not complete: ' + String(error)); }
}
