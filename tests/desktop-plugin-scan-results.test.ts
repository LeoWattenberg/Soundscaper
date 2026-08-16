/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAXIMUM_PLUGIN_CHANNEL_LAYOUTS,
	MAXIMUM_PLUGIN_SCAN_ENTRIES,
	projectPluginScanForRenderer,
	validateHelperPluginScanResult,
} from '../desktop/plugin-scan-results.ts';

const ENTRY = Object.freeze({
	stableId: 'com.example.reverb',
	name: 'Example Reverb',
	vendor: 'Example Audio',
	version: '2.1.0',
	binaryPath: '/opt/plug-ins/Example Reverb.vst3',
	binaryBytes: 4_194_304,
	binarySha256: 'b'.repeat(64),
	classification: 'effect',
	channelSupport: [{ inputs: 2, outputs: 2 }],
	realtime: true,
	offline: true,
	reportedLatencyFrames: 512,
	signature: 'signed-valid',
	compatibility: 'compatible',
	descriptorVersion: 3,
});

function entryWith(patch: Record<string, unknown>): Record<string, unknown> {
	return { ...ENTRY, ...patch };
}

function scanWith(patch: Record<string, unknown>): Record<string, unknown> {
	return { format: 'vst3', status: 'scanned', detail: '', entries: [ENTRY], ...patch };
}

test('a well-formed scan is admitted, frozen and unchanged field by field', () => {
	const scan = validateHelperPluginScanResult(scanWith({ detail: 'Scanned 1 bundle.' }));
	assert.equal(scan.format, 'vst3');
	assert.equal(scan.status, 'scanned');
	assert.equal(scan.detail, 'Scanned 1 bundle.');
	assert.equal(Object.isFrozen(scan), true);
	assert.equal(Object.isFrozen(scan.entries), true);
	assert.equal(scan.entries.length, 1);
	assert.deepEqual({ ...scan.entries[0] }, { ...ENTRY, channelSupport: [{ inputs: 2, outputs: 2 }] });
	assert.equal(Object.isFrozen(scan.entries[0]), true);
	assert.equal(Object.isFrozen(scan.entries[0].channelSupport), true);
});

test('an empty scan of an unreadable or unsupported root is admitted with no entries', () => {
	for (const status of ['unsupported-format', 'root-unreadable'] as const) {
		const scan = validateHelperPluginScanResult(scanWith({ status, detail: 'nope', entries: [] }));
		assert.equal(scan.status, status);
		assert.deepEqual(scan.entries, []);
	}
});

test('a scan that did not complete may not smuggle entries through', () => {
	for (const status of ['unsupported-format', 'root-unreadable'] as const) {
		assert.throws(() => validateHelperPluginScanResult(scanWith({ status })),
			/did not complete must publish no entries/u,
			`${status} must not carry entries`);
	}
});

test('the closed vocabulary of a scan result is enforced in every position', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({ format: 'vst2' })), /known plug-in format/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ status: 'partial' })), /known plug-in scan status/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ classification: 'synth' })] })),
		/known plug-in classification/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ signature: 'notarized' })] })),
		/known plug-in signature result/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ compatibility: 'maybe' })] })),
		/known plug-in compatibility result/u);
});

test('a result or entry with extra, missing or non-record shape is refused', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({ scannedAt: 1 })), /exactly its schema keys/u);
	assert.throws(() => validateHelperPluginScanResult({ format: 'vst3', status: 'scanned', entries: [] }),
		/exactly its schema keys/u);
	assert.throws(() => validateHelperPluginScanResult([ENTRY]), /must be a plain record/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: 'none' })), /must carry its entry list/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ extra: true })] })),
		/exactly its schema keys/u);
	const { binaryPath: _binaryPath, ...withoutPath } = ENTRY;
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [withoutPath] })), /exactly its schema keys/u);
});

test('one scan may not report the same stable id twice', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: [ENTRY, entryWith({ name: 'Example Reverb (2)', binarySha256: 'c'.repeat(64) })],
	})), /same stable id twice/u);
	const distinct = validateHelperPluginScanResult(scanWith({
		entries: [ENTRY, entryWith({ stableId: 'com.example.delay' })],
	}));
	assert.deepEqual(distinct.entries.map(({ stableId }) => stableId), ['com.example.reverb', 'com.example.delay']);
});

test('a scan is bounded in entries, channel layouts and detail length', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: Array.from({ length: MAXIMUM_PLUGIN_SCAN_ENTRIES + 1 }, (_unused, index) => entryWith({
			stableId: `com.example.plug${String(index)}`,
		})),
	})), /at most 512 plug-ins/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: [entryWith({
			channelSupport: Array.from({ length: MAXIMUM_PLUGIN_CHANNEL_LAYOUTS + 1 }, () => ({ inputs: 2, outputs: 2 })),
		})],
	})), /at most 32 channel layouts/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ detail: 'x'.repeat(1_025) })),
		/detail must be bounded text/u);
	const atCeiling = validateHelperPluginScanResult(scanWith({ detail: 'x'.repeat(1_024) }));
	assert.equal(atCeiling.detail.length, 1_024);
});

test('a scanned binary path must be absolute and traversal-free', () => {
	for (const binaryPath of [
		'plug-ins/Example.vst3',
		'/opt/plug-ins/../../etc/shadow',
		'/opt/plug-ins/Example.vst3\0',
		'',
		42,
	]) {
		assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ binaryPath })] })),
			/absolute, traversal-free binary path/u,
			`${String(binaryPath)} must not be admitted`);
	}
	const windows = validateHelperPluginScanResult(scanWith({
		entries: [entryWith({ binaryPath: 'C:\\Program Files\\Common Files\\VST3\\Example.vst3' })],
	}));
	assert.equal(windows.entries[0].binaryPath, 'C:\\Program Files\\Common Files\\VST3\\Example.vst3');
});

test('a scanned binary must carry a lowercase digest and a real byte length', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ binarySha256: 'B'.repeat(64) })] })),
		/lowercase SHA-256/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ binarySha256: 'b'.repeat(63) })] })),
		/lowercase SHA-256/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ binaryBytes: 0 })] })),
		/binary byte length is outside its admitted bounds/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ binaryBytes: 1.5 })] })),
		/binary byte length is outside its admitted bounds/u);
});

test('capability fields are admitted exactly as declared, never coerced', () => {
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ realtime: 'yes' })] })),
		/real-time and offline support as booleans/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ offline: 1 })] })),
		/real-time and offline support as booleans/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: [entryWith({ channelSupport: [{ inputs: 2, outputs: 65 }] })],
	})), /output channel count is outside its admitted bounds/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: [entryWith({ channelSupport: [{ inputs: -1, outputs: 2 }] })],
	})), /input channel count is outside its admitted bounds/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({
		entries: [entryWith({ channelSupport: [{ inputs: 2, outputs: 2, sidechain: 1 }] })],
	})), /exactly its schema keys/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ reportedLatencyFrames: -1 })] })),
		/reported latency is outside its admitted bounds/u);
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ descriptorVersion: 65_536 })] })),
		/descriptor version is outside its admitted bounds/u);
	const unreported = validateHelperPluginScanResult(scanWith({
		entries: [entryWith({ reportedLatencyFrames: null, channelSupport: [] })],
	}));
	assert.equal(unreported.entries[0].reportedLatencyFrames, null);
	assert.deepEqual(unreported.entries[0].channelSupport, []);
});

test('a sparse entry or channel list is refused rather than admitted as holes', () => {
	// `Array.prototype.map` skips holes, so a hole is an entry that no validator
	// ever saw: it would reach a renderer as a null and reach main-side code as
	// undefined, and it would slip past the duplicate-id check on the way.
	const sparseEntries: unknown[] = [];
	sparseEntries.length = 3;
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: sparseEntries })),
		/must carry its entry list/u);
	const sparseLayouts: unknown[] = [];
	sparseLayouts.length = 2;
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: [entryWith({ channelSupport: sparseLayouts })] })),
		/must carry its channel support list/u);
	const oneHole = [ENTRY, undefined];
	delete oneHole[1];
	assert.throws(() => validateHelperPluginScanResult(scanWith({ entries: oneHole })), /must carry its entry list/u);
});

test('every field is admitted on the read that checked it, never re-read afterwards', () => {
	// A record whose properties answer differently each time is the general form
	// of every check-then-store bug: whatever a guard approved must be the value
	// that is stored, so admission cannot be walked past by a second answer.
	function trap(key: string, approved: unknown, smuggled: unknown, honestReads: number): Record<string, unknown> {
		let reads = 0;
		const entry: Record<string, unknown> = { ...ENTRY };
		Object.defineProperty(entry, key, {
			enumerable: true,
			get() {
				reads += 1;
				return reads <= honestReads ? approved : smuggled;
			},
		});
		return entry;
	}
	const digest = validateHelperPluginScanResult(scanWith({
		entries: [trap('binarySha256', 'b'.repeat(64), 'NOT A DIGEST', 2)],
	}));
	assert.equal(digest.entries[0].binarySha256, 'b'.repeat(64));
	const realtime = validateHelperPluginScanResult(scanWith({ entries: [trap('realtime', true, 'definitely', 1)] }));
	assert.equal(realtime.entries[0].realtime, true);
	const offline = validateHelperPluginScanResult(scanWith({ entries: [trap('offline', false, 1, 1)] }));
	assert.equal(offline.entries[0].offline, false);
});

test('the renderer projection strips the binary path and keeps everything else', () => {
	const scan = validateHelperPluginScanResult(scanWith({ detail: 'Scanned 2 bundles.', entries: [
		ENTRY,
		entryWith({
			stableId: 'com.example.piano',
			name: 'Example Piano',
			classification: 'instrument',
			binaryPath: '/opt/plug-ins/Example Piano.vst3',
			binarySha256: 'd'.repeat(64),
		}),
	] }));
	const projected = projectPluginScanForRenderer(scan);
	assert.equal(projected.format, 'vst3');
	assert.equal(projected.status, 'scanned');
	assert.equal(projected.detail, 'Scanned 2 bundles.');
	for (const entry of projected.entries) {
		assert.equal(Object.hasOwn(entry, 'binaryPath'), false, 'no projected entry may carry a raw path');
	}
	assert.equal(JSON.stringify(projected).includes('/opt/plug-ins'), false,
		'no raw path may survive anywhere in the projection');
	assert.deepEqual(Object.keys(projected.entries[0]), [
		'stableId', 'name', 'vendor', 'version', 'binaryBytes', 'binarySha256', 'classification',
		'channelSupport', 'realtime', 'offline', 'reportedLatencyFrames', 'signature', 'compatibility',
		'descriptorVersion',
	]);
	// An instrument is identified by the scan and stays identified; refusing to
	// offer it is a registry decision, not a reason to hide that it exists.
	assert.equal(projected.entries[1].classification, 'instrument');
	assert.equal(projected.entries[1].binarySha256, 'd'.repeat(64));
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.entries[0]), true);
});

test('projecting a scan does not mutate or share the admitted result', () => {
	const scan = validateHelperPluginScanResult(scanWith({}));
	const projected = projectPluginScanForRenderer(scan);
	assert.equal(scan.entries[0].binaryPath, '/opt/plug-ins/Example Reverb.vst3');
	assert.equal(projected.entries.length, scan.entries.length);
	assert.notEqual(projected.entries[0] as unknown, scan.entries[0] as unknown);
});
