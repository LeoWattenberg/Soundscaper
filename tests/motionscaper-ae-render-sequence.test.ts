/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import type { MotionAeExchange } from '../src/common/editor/motion-ae-exchange-types.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
function fixture(count = 2) {
	const assets: MotionAsset[] = Array.from({ length: count }, (_, index) => ({ kind: 'image', id: `asset-${index}`, name: `Frame ${index}`, width: 64, height: 64, hasAlpha: true,
		mimeType: 'image/png', byteLength: 40, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}` }));
	const exchange: MotionAeExchange = { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'render-transfer', producer: { application: 'after-effects', version: 'unqualified', bridgeVersion: '0.1.0' },
		source: { name: 'Original.aep', revisionDigest: null }, color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		footage: assets.map((asset, index) => ({ id: `frame-${index}`, name: asset.name, path: `media/frame-${index}.png`, byteLength: asset.byteLength, sha256: asset.sha256,
			width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 0, still: true, hasVideo: true, hasAudio: false })),
		compositions: [{ id: 'comp', name: 'Rendered scene', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: count / 24, displayStartTime: 0, background: [0, 0, 0], layers: [
			{ id: 'original-text', name: 'Original title', kind: 'text', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: count / 24, stretch: 100,
				enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [] },
		] }], report: assets.map((_, index) => ({ scopeId: 'comp', propertyPath: `frame/${index}`, status: 'rendered', code: 'composition-render-frame', mediaId: `frame-${index}`, message: 'Whole composition frame; reference qualification pending.' })) };
	let serial = 0;
	return { exchange, options: { projectId: 'new-project', allocateId: () => `new-${++serial}`, bindings: assets.map((asset, index) => ({ footageId: `frame-${index}`, asset })) } };
}
test('AE rendered fallback consumes every exact frame while retaining original authored layers in custody', () => {
	const { exchange, options } = fixture(), result = convertMotionscaperAeExchange(exchange, options), layers = result.project.compositions[0]!.layers;
	assert.equal(layers.length, 2); assert.deepEqual(layers.map(layer => layer.kind), ['image', 'image']);
	assert.deepEqual(layers.map(layer => [layer.inFrame, layer.outFrame]), [[{ num: 0, den: 1 }, { num: 1, den: 1 }], [{ num: 1, den: 1 }, { num: 2, den: 1 }]]);
	assert.deepEqual(layers.map(layer => layer.kind === 'image' ? layer.assetId : null), ['asset-0', 'asset-1']);
	assert.equal(result.exchange.compositions[0]!.layers[0]!.kind, 'text'); assert.equal(result.report.filter(entry => entry.status === 'rendered').length, 2);
	assert.ok(result.report.some(entry => entry.code === 'render-sequence-audio' && entry.status === 'unsupported'));
});
test('AE rendered fallback refuses partial, duplicate, mismatched and undecoded sequence claims', () => {
	const { exchange, options } = fixture();
	assert.throws(() => convertMotionscaperAeExchange({ ...exchange, report: exchange.report.slice(0, 1) }, options), /complete.*sequence/iu);
	assert.throws(() => convertMotionscaperAeExchange({ ...exchange, report: [exchange.report[0], exchange.report[0]] }, options), /sequence/iu);
	assert.throws(() => convertMotionscaperAeExchange({ ...exchange, compositions: [{ ...exchange.compositions[0], pixelAspect: 2 }] }, options), /sequence/iu);
	assert.throws(() => convertMotionscaperAeExchange(exchange, { ...options, bindings: options.bindings.slice(0, 1) }), /sequence/iu);
	assert.throws(() => convertMotionscaperAeExchange(exchange, { ...options, bindings: options.bindings.map(item => ({ ...item, asset: { ...item.asset, hasAlpha: false } })) }), /sequence/iu);
});
test('AE rendered sequences retain a finite project traversal admission', () => {
	const accepted = fixture(256), converted = convertMotionscaperAeExchange(accepted.exchange, accepted.options);
	const retained = normalizeMotionscaperProject({ ...converted.project, interchangeCustody: { format: 'org.motionscaper.ae-project-custody', version: 1, exchange: converted.exchange, report: converted.report, media: accepted.options.bindings.map(({ footageId, asset }) => ({ sourceId: footageId, assetId: asset.id, sha256: asset.sha256, byteLength: asset.byteLength })) } });
	assert.equal(retained.compositions[0]!.layers.length, 256);
	const bounded = fixture(2048); assert.throws(() => convertMotionscaperAeExchange(bounded.exchange, bounded.options), /budget|traversal/u);
});
