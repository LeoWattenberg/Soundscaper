/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { exportMotionAeHostProject, type MotionAeExportHost } from '../src/common/editor/motion-ae-host-export.ts';
import { normalizeMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';
test('AE exporter stages a new package and publishes its manifest last without saving the source project', () => {
	const operations: string[] = [];
	const host: MotionAeExportHost = {
		version: 'host-model-not-AE', projectName: 'Source.aep', color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		compositions: () => [{ id: 'comp', name: 'Original', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [] }],
		footage: () => [], checkCancelled: () => {},
		begin: () => { operations.push('begin'); return { copyMedia: () => { operations.push('copy'); }, publish: () => { operations.push('publish'); }, rollback: () => { operations.push('rollback'); } }; },
	};
	const result = exportMotionAeHostProject(host, 'transfer');
	assert.equal(normalizeMotionAeExchange(result).source.name, 'Source.aep'); assert.deepEqual(operations, ['begin', 'publish']);
	assert.equal(result.report[0]!.status, 'unsupported'); assert.match(result.report[0]!.message, /qualified/u);
});
test('AE exporter preserves source references and rolls back only its own pending package on cancellation', () => {
	const operations: string[] = []; let cancelled = false;
	const media = { id: 'footage', name: 'Clip.mp4', path: 'media/footage.mp4', byteLength: 10, sha256: null, width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, hasVideo: true, hasAudio: false, still: false };
	const host: MotionAeExportHost = {
		version: 'host-model-not-AE', projectName: 'Source.aep', color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		compositions: () => [{ id: 'comp', name: 'Original', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [] }],
		footage: () => [media], checkCancelled: () => { if (cancelled) throw new Error('cancelled'); },
		begin: () => ({ copyMedia: (item) => { operations.push(item.path!); cancelled = true; }, publish: () => { operations.push('publish'); }, rollback: () => { operations.push('rollback'); } }),
	};
	assert.throws(() => exportMotionAeHostProject(host, 'transfer'), /cancelled/u); assert.deepEqual(operations, ['media/footage.mp4', 'rollback']);
	assert.equal(media.path, 'media/footage.mp4');
});
test('AE exporter preserves both transfer and cleanup errors for review', () => {
	const host = { version: 'host-model', projectName: 'Original.aep', color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		compositions: () => [], footage: () => [], checkCancelled: () => {},
		begin: () => ({ copyMedia: () => {}, publish: () => { throw new Error('write denied'); }, rollback: () => { throw new Error('cleanup denied'); } }),
	} as MotionAeExportHost;
	assert.throws(() => exportMotionAeHostProject(host, 'transfer'), /write denied.*cleanup denied/u);
});
