/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeShapeTarget } from '../../src/common/editor/motion-ae-host-apply-shape.ts';
import type { MotionAeShapeProfile } from '../../src/common/editor/motion-ae-host-shape-profile.ts';
export const shapeHostProfile: MotionAeShapeProfile = { format: 'org.motionscaper.ae-shape-profile', version: 1, reviewed: true, host: { version: '25.0', buildNumber: 5, locale: 'en_US' },
	mapping: { groupNormal: 81, fillNormal: 82, strokeNormal: 83, fillNonzero: 91, fillEvenodd: 92, capButt: 101, capRound: 102, capSquare: 103, joinMiter: 111, joinRound: 112, joinBevel: 113, pathForward: 121, pathReversed: 122 } };
export function shapeHostFixture(manifest: string, profile: MotionAeShapeProfile | null = shapeHostProfile, clampPopup = false) {
	const calls: string[] = [], alerts: string[] = [], files = new Map([['/package/motionae.json', manifest], ['/profile.json', JSON.stringify(profile)]]); let choices = 0;
	class Folder { readonly alias = false; constructor(readonly fsName: string) {} }
	class File {
		readonly alias = false; encoding = ''; constructor(readonly fsName: string) {} get exists() { return files.has(this.fsName); } get length() { return files.get(this.fsName)?.length ?? 0; }
		get parent() { return new Folder('/package'); } open() { return this.exists; } close() { return true; } read() { return files.get(this.fsName)!; }
		static openDialog() { choices++; return choices === 1 ? new File('/package/motionae.json') : profile ? new File('/profile.json') : null; }
	}
	class Property implements MotionAeShapeTarget {
		name: string; canSetEnabled = true; enabled = true; value: unknown = null; children: Property[] = []; fields = new Map<string, Property>(); keys = new Map<number, unknown>(); interpolation: [number, unknown, unknown][] = [];
		constructor(readonly matchName: string, readonly propertyIndex = 0) { this.name = matchName; }
		get numProperties() { return this.children.length; } get numKeys() { return this.keys.size; }
		property(name: string | number): Property | null {
			if (typeof name === 'number') return this.children[name - 1] ?? null;
			if (['ADBE Vector Stroke Dashes', 'ADBE Vector Stroke Taper', 'ADBE Vector Stroke Wave'].includes(name)) return null;
			let field = this.fields.get(name); if (!field) { field = new Property(name); this.fields.set(name, field); } return field;
		}
		addProperty(name: string) { const result = new Property(name, this.children.length + 1); this.children.push(result); return result; }
		setValue(value: unknown) { this.value = clampPopup && this.matchName === 'ADBE Vector Stroke Line Cap' ? 999 : value; }
		setValueAtTime(time: number, value: unknown) { this.keys.set(time, value); }
		setInterpolationTypeAtKey(index: number, incoming: unknown, outgoing: unknown) { this.interpolation.push([index, incoming, outgoing]); }
		setTemporalAutoBezierAtKey() {} setTemporalContinuousAtKey() {} setTemporalEaseAtKey() {} setSpatialAutoBezierAtKey() {} setSpatialContinuousAtKey() {} setSpatialTangentsAtKey() {} setRovingAtKey() {}
	}
	class Layer {
		name = ''; enabled = true; audioEnabled = true; threeDLayer = false; startTime = 0; inPoint = 0; outPoint = 1; stretch = 100;
		root = new Property('ADBE Root Vectors Group'); transform = new Property('ADBE Transform Group');
		property(name: string) { return name === this.root.matchName ? this.root : this.transform; } setParentWithJump() {}
	}
	class Item {
		parentFolder: Item | null = null; constructor(public name: string) {} remove() { calls.push('remove:' + this.name); items.splice(items.indexOf(this), 1); }
	}
	class Composition extends Item {
		displayStartTime = 0; bgColor: readonly number[] = []; authored: Layer[] = [];
		layers = { addShape: () => { const layer = new Layer(); this.authored.unshift(layer); calls.push('shape'); return layer; } };
	}
	const existing = new Item('Existing source'), items: Item[] = [existing];
	const project = { workingSpace: '', linearBlending: true, bitsPerChannel: 32,
		items: { addFolder: (name: string) => { const item = new Item(name); items.push(item); return item; }, addComp: (name: string) => { const comp = new Composition(name); items.push(comp); return comp; } } };
	return { items, existing, files, alerts, calls, Composition, Property, sandbox: { app: { version: shapeHostProfile.host.version, buildNumber: shapeHostProfile.host.buildNumber, isoLanguage: shapeHostProfile.host.locale,
		project, beginUndoGroup: () => { calls.push('begin'); }, endUndoGroup: () => { calls.push('end'); } }, File, Folder,
		Shape: class {}, KeyframeInterpolationType: { HOLD: 'hold', LINEAR: 'linear', BEZIER: 'bezier' }, confirm: () => true, alert: (message: string) => { alerts.push(message); }, JSON: undefined } };
}
