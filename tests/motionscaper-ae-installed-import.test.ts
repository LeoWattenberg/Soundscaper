/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { motionAeTextFixture } from './helpers/motionscaper-ae-text-fixture.ts';
import { createHash } from 'node:crypto';
async function script(): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url), entry = await readFile(new URL('Motionscaper-Import.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); }
	return parts.join('\n');
}
function manifest(media = false, wrongDigest = false) {
	const ease = [{ speed: 0, influence: 33.333 }], property = { kind: 'numeric', name: 'Position', matchName: 'ADBE Position', spatial: true, value: [2, 3], expression: null,
		keys: [0, 1].map((time) => ({ time, value: time ? [10, 11] : [2, 3], inInterpolation: 'bezier', outInterpolation: 'bezier', inEase: ease, outEase: ease, inSpatialTangent: [0, 0], outSpatialTangent: [0, 0], roving: false })) };
	return JSON.stringify({ format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'test-transfer', color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 }, report: [],
		footage: media ? [{ id: 'asset', name: 'Media', path: 'media/asset.png', byteLength: 3, sha256: wrongDigest ? '0'.repeat(64) : createHash('sha256').update('abc').digest('hex') }] : [],
		compositions: [{ id: 'comp', name: 'Imported Comp', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 2, displayStartTime: 0, background: [0, 0, 0], layers: [
			{ id: 'child', name: 'Child', kind: media ? 'footage' : 'null', sourceId: media ? 'asset' : null, parentId: 'parent', matte: null, startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [{ kind: 'group', matchName: 'ADBE Transform Group', name: 'Transform', children: [property] }] },
			{ id: 'parent', name: 'Parent', kind: 'null', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [] },
		] }] });
}
function host(source: string, failLayer = false) {
	const files = new Map([['/package/motionae.json', source], ['/package/media/asset.png', 'abc']]), alerts: string[] = [], calls: string[] = [];
	class Folder { fsName: string; alias = false; constructor(path: string) { this.fsName = path; } }
	class File {
		fsName: string; alias = false; encoding = ''; offset = 0; constructor(path: string) { this.fsName = path; }
		get parent() { return new Folder(this.fsName.replace(/\/[^/]+$/u, '')); } get exists() { return files.has(this.fsName); } get length() { return Buffer.byteLength(files.get(this.fsName) ?? ''); }
		open(mode: string) { assert.equal(mode, 'r'); this.offset = 0; return this.exists; } close() { return true; }
		read(count?: number) { const value = files.get(this.fsName)!.substr(this.offset, count); this.offset += value.length; return value; }
		static openDialog() { return new File('/package/motionae.json'); }
	}
	class Property {
		numKeys = 0; keys = new Map<number, readonly number[]>(); value: unknown = null;
		setValue(value: unknown) { this.value = value; } setValueAtTime(time: number, value: readonly number[]) { this.keys.set(time, value); this.numKeys = this.keys.size; }
		setInterpolationTypeAtKey() { calls.push('interpolation'); } setTemporalEaseAtKey() { calls.push('ease'); }
		setTemporalAutoBezierAtKey() {} setTemporalContinuousAtKey() {} setSpatialAutoBezierAtKey() {} setSpatialContinuousAtKey() {}
		setSpatialTangentsAtKey() { calls.push('tangents'); } setRovingAtKey() {}
		set expression(_value: string) { throw new Error('Expression source must remain inert.'); }
	}
	class Mask {
		name = ''; maskMode: unknown; inverted = false; rotoBezier = true; maskFeatherFalloff: unknown; maskMotionBlur: unknown;
		fields = new Map<string, Property>(); property(name: string) { let field = this.fields.get(name); if (!field) { field = new Property(); this.fields.set(name, field); } return field; }
	}
	class TextDocument {
		text = ''; fontObject: unknown = null; autoLeading = true; private spacing = 0;
		get leading() { return this.spacing; } set leading(value: number) { this.spacing = value; this.autoLeading = true; }
		resetCharStyle() {} resetParagraphStyle() {}
	}
	class Layer {
		name = ''; enabled = true; audioEnabled = true; threeDLayer = false; startTime = 0; inPoint = 0; outPoint = 2; stretch = 100; parent: Layer | null = null; position = new Property();
		masks: Mask[] = []; sourceText = new Property();
		matte: { source: Layer; type: unknown } | null = null;
		setTrackMatte(source: Layer, type: unknown) { this.matte = { source, type }; source.enabled = true; calls.push('matte'); }
		setParentWithJump(parent: Layer) { this.parent = parent; }
		property(name: string) { return name === 'ADBE Text Properties' ? { property: () => this.sourceText } : name === 'ADBE Mask Parade' ? { addProperty: (matchName: string) => { assert.equal(matchName, 'ADBE Mask Atom'); const mask = new Mask(); this.masks.push(mask); return mask; } } : { property: () => this.position }; }
	}
	class Item {
		name: string; parentFolder: Item | null = null; constructor(name: string) { this.name = name; }
		remove() { const index = items.indexOf(this); if (index >= 0) items.splice(index, 1); calls.push('remove:' + this.name); }
	}
	class Composition extends Item {
		displayStartTime = 0; bgColor: readonly number[] = [0, 0, 0]; authored: Layer[] = [];
		layers = { addBoxText: (_size: readonly number[], text: string) => { const layer = this.add(); const document = new TextDocument(); document.text = text; layer.sourceText.value = document; return layer; }, addNull: () => this.add(), add: (_item: Item) => this.add() };
		add() { if (failLayer && this.authored.length) throw new Error('layer creation failed'); const layer = new Layer(); this.authored.unshift(layer); return layer; }
	}
	const existing = new Item('Existing original item'), items: Item[] = [existing];
	const project = { workingSpace: '', linearBlending: false, bitsPerChannel: 8,
		items: { addFolder: (name: string) => { const item = new Item(name); items.push(item); return item; },
			addComp: (name: string) => { const item = new Composition(name); items.push(item); return item; } },
		importFile: () => { const item = new Item('Imported footage'); items.push(item); return item; },
	};
	class ImportOptions { file: File; sequence = true; importAs: unknown; constructor(file: File) { this.file = file; } }
	return { items, existing, files, alerts, calls, project, Composition, Layer, sandbox: { app: { version: '23.0 synthetic host', fonts: { getFontsByPostScriptName: (name: string) => [{ postScriptName: name, isSubstitute: false, hasDesignAxes: false }] }, project, beginUndoGroup: () => calls.push('begin'), endUndoGroup: () => calls.push('end') }, File, Folder, ImportOptions,
		ImportAsType: { FOOTAGE: 'footage' }, KeyframeInterpolationType: { HOLD: 'hold', LINEAR: 'linear', BEZIER: 'bezier' }, KeyframeEase: class {},
		Shape: class {}, MaskMode: { ADD: 'add', SUBTRACT: 'subtract' }, MaskFeatherFalloff: { FFO_LINEAR: 'linear', FFO_SMOOTH: 'smooth' }, MaskMotionBlur: { SAME_AS_LAYER: 'same', OFF: 'off' },
		ParagraphJustification: { LEFT_JUSTIFY: 'left', CENTER_JUSTIFY: 'center', RIGHT_JUSTIFY: 'right' }, LineOrientation: { HORIZONTAL: 'horizontal', VERTICAL_RIGHT_TO_LEFT: 'vertical-right', VERTICAL_LEFT_TO_RIGHT: 'vertical-left' },
		AutoKernType: { METRIC_KERN: 'metric' }, BaselineDirection: { BASELINE_WITH_STREAM: 'baseline' }, FontCapsOption: { FONT_NORMAL_CAPS: 'caps' }, FontBaselineOption: { FONT_NORMAL_BASELINE: 'normal-baseline' },
		ParagraphDirection: { DIRECTION_LEFT_TO_RIGHT: 'ltr' }, DigitSet: { DEFAULT_DIGITS: 'digits' }, LeadingType: { ROMAN_LEADING_TYPE: 'roman' },
		BoxAutoFitPolicy: { NONE: 'none' }, BoxVerticalAlignment: { TOP: 'top' }, BoxFirstBaselineAlignment: { ASCENT: 'ascent' },
		TrackMatteType: { ALPHA: 'alpha', ALPHA_INVERTED: 'alpha-inverted', LUMA: 'luma', LUMA_INVERTED: 'luma-inverted' },
		alert: (message: string) => alerts.push(message), confirm: () => true, JSON: undefined } };
}
test('generated AE importer creates separate compositions, parent links and spatial keys while preserving existing items', async () => {
	const fixture = host(manifest(true)); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange imported/u); assert.ok(fixture.items.includes(fixture.existing));
	const comp = fixture.items.find((item) => item instanceof fixture.Composition)! as InstanceType<typeof fixture.Composition>;
	assert.deepEqual(comp.authored.map((layer) => layer.name), ['Child', 'Parent']); assert.equal(comp.authored[0]!.parent, comp.authored[1]);
	assert.deepEqual([...comp.authored[0]!.position.keys].map(([time, values]) => [time, Array.from(values)]), [[0, [2, 3]], [1, [10, 11]]]);
	assert.equal(fixture.calls.filter((call) => call === 'ease').length, 2); assert.equal(fixture.calls.filter((call) => call === 'tangents').length, 2);
	assert.equal(fixture.files.get('/package/media/asset.png'), 'abc'); assert.equal(fixture.calls.at(-1), 'end');
});
test('generated AE importer binds matte IDs with AE23 API and restores source visibility without reordering layers', async () => {
	const input = JSON.parse(manifest()) as { compositions: { layers: { id: string; enabled: boolean; matte: null | { layerId: string; type: string } }[] }[] };
	const layers = input.compositions[0]!.layers; layers[0]!.matte = { layerId: layers[1]!.id, type: 'luma-inverted' }; layers[1]!.enabled = false;
	const fixture = host(JSON.stringify(input)); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange imported/u); const comp = fixture.items.find(item => item instanceof fixture.Composition)! as InstanceType<typeof fixture.Composition>;
	assert.deepEqual(comp.authored.map(layer => layer.name), ['Child', 'Parent']); assert.equal(comp.authored[0]!.matte!.source, comp.authored[1]);
	assert.equal(comp.authored[0]!.matte!.type, 'luma-inverted'); assert.equal(comp.authored[1]!.enabled, false);
	const older = host(JSON.stringify(input)); older.sandbox.app.version = '22.6'; vm.runInNewContext(await script(), older.sandbox, { timeout: 5000 });
	assert.match(older.alerts[0]!, /23 or newer/u); assert.deepEqual(older.calls, []); assert.deepEqual(older.items, [older.existing]);
	const missing = host(JSON.stringify(input)); Object.defineProperty(missing.Layer.prototype, 'setTrackMatte', { value: undefined }); vm.runInNewContext(await script(), missing.sandbox, { timeout: 5000 });
	assert.match(missing.alerts[0]!, /setTrackMatte/u); assert.deepEqual(missing.items, [missing.existing]);
});
test('generated AE importer creates real Shape values and explicit hard-edge mask attributes from its admitted plan', async () => {
	const input = JSON.parse(manifest()) as { compositions: { layers: { properties: unknown[] }[] }[] };
	const numeric = (matchName: string, value: number[]) => ({ kind: 'numeric', name: matchName, matchName, value, spatial: false, keys: [], expression: null });
	const shape = { closed: true, vertices: [[0, 0], [20, 0], [10, 20]], inTangents: [[-2, 1], [0, 0], [0, 0]], outTangents: [[4, 3], [0, 0], [0, 0]] };
	const mask = { kind: 'group', name: 'Owned mask', matchName: 'ADBE Mask Atom', mask: { mode: 'subtract', inverted: true, rotoBezier: false, featherFalloff: 'linear', motionBlur: 'off' }, children: [
		{ kind: 'shape', name: 'Path', matchName: 'ADBE Mask Shape', value: shape, keys: [], expression: null },
		numeric('ADBE Mask Opacity', [75]), numeric('ADBE Mask Feather', [0, 0]), numeric('ADBE Mask Offset', [0]),
	] };
	input.compositions[0]!.layers[0]!.properties.push({ kind: 'group', name: 'Masks', matchName: 'ADBE Mask Parade', children: [mask] });
	const fixture = host(JSON.stringify(input)); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange imported/u);
	const comp = fixture.items.find(item => item instanceof fixture.Composition)! as InstanceType<typeof fixture.Composition>;
	const target = comp.authored[0]!.masks[0]!; assert.equal(target.name, 'Owned mask'); assert.equal(target.maskMode, 'subtract'); assert.equal(target.inverted, true); assert.equal(target.rotoBezier, false);
	assert.equal(target.maskMotionBlur, 'off'); assert.equal(target.fields.get('ADBE Mask Opacity')!.value, 75);
	const value = target.fields.get('ADBE Mask Shape')!.value; assert.ok(value instanceof fixture.sandbox.Shape); assert.deepEqual(JSON.parse(JSON.stringify(value)), shape);
	mask.mask.rotoBezier = true; const refused = host(JSON.stringify(input)); vm.runInNewContext(await script(), refused.sandbox, { timeout: 5000 });
	assert.match(refused.alerts[0]!, /RotoBezier/u); assert.deepEqual(refused.items, [refused.existing]); assert.deepEqual(refused.calls, []);
});
test('generated AE importer refuses changed media and color mismatch before creating objects', async () => {
	const changed = host(manifest(true, true)); vm.runInNewContext(await script(), changed.sandbox, { timeout: 5000 });
	assert.match(changed.alerts[0]!, /SHA-256 changed/u); assert.deepEqual(changed.items, [changed.existing]); assert.equal(changed.calls.length, 0);
	const color = host(manifest()); color.project.workingSpace = 'Different'; vm.runInNewContext(await script(), color.sandbox, { timeout: 5000 });
	assert.match(color.alerts[0]!, /matching working space/u); assert.equal(color.calls.length, 0);
});
test('generated AE importer rolls back new objects after creation failure and leaves original items present', async () => {
	const fixture = host(manifest(), true); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /layer creation failed/u); assert.deepEqual(fixture.items, [fixture.existing]); assert.equal(fixture.calls.at(-1), 'end');
});

test('generated AE importer mutes the Motion-authored video-only subset without muting legacy exchanges', async () => {
	const input = JSON.parse(manifest(true)) as Record<string, unknown>;
	const motion = host(JSON.stringify({ ...input, producer: { application: 'motionscaper', bridgeVersion: '0.1.0', version: '0.1.0-alpha.1' } }));
	vm.runInNewContext(await script(), motion.sandbox, { timeout: 5000 });
	assert.match(motion.alerts[0]!, /Exchange imported/u);
	const comp = motion.items.find(item => item instanceof motion.Composition)! as InstanceType<typeof motion.Composition>;
	assert.ok(comp.authored.every(layer => !layer.audioEnabled));
	const legacy = host(manifest(true)); vm.runInNewContext(await script(), legacy.sandbox, { timeout: 5000 });
	const original = legacy.items.find(item => item instanceof legacy.Composition)! as InstanceType<typeof legacy.Composition>;
	assert.ok(original.authored.every(layer => layer.audioEnabled));
});

test('generated AE importer preflights real font identity and creates reviewed paragraph text through addBoxText', async () => {
	const source = motionAeTextFixture(); const fixture = host(JSON.stringify({ ...source, color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 } }));
	fixture.sandbox.app.version = '24.6 synthetic host'; vm.runInNewContext(await script(), fixture.sandbox, { timeout: 5000 });
	assert.match(fixture.alerts[0]!, /Exchange imported/u);
	const comp = fixture.items.find(item => item instanceof fixture.Composition)! as InstanceType<typeof fixture.Composition>;
	const text = comp.authored[0]!.sourceText.value as Record<string, unknown>;
	assert.equal(text.text, 'Retained\rtext'); assert.equal(text.fontSize, 40); assert.equal(text.leading, 48); assert.equal(text.autoLeading, false);
	assert.equal((text.fontObject as { postScriptName: string }).postScriptName, 'ExactFace-Regular');
	assert.deepEqual(Array.from(text.boxTextPos as number[]), [-10, -30]);
	for (const reason of ['old', 'missing', 'substitute', 'variable']) {
		const refused = host(JSON.stringify({ ...source, color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 } })); refused.sandbox.app.version = reason === 'old' ? '24.5' : '24.6';
		refused.sandbox.app.fonts.getFontsByPostScriptName = name => reason === 'missing' ? [] : [{ postScriptName: name, isSubstitute: reason === 'substitute', hasDesignAxes: reason === 'variable' }];
		vm.runInNewContext(await script(), refused.sandbox, { timeout: 5000 });
		assert.match(refused.alerts[0]!, /font|24.6/iu); assert.deepEqual(refused.calls, []); assert.deepEqual(refused.items, [refused.existing]);
	}
});
