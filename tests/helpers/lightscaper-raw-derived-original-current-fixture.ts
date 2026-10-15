/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compilePinnedLibRawModuleV1 } from '../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { compilePinnedLibRawRecoveryModuleV2 } from '../../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { withDecodedRawOriginalV1 } from '../../src/common/editor/raw/libraw-runtime-v1.ts';
import { withDecodedRawRecoveryFrameV2 } from '../../src/common/editor/raw/libraw-runtime-v2.ts';
import type { PhotoOriginalDerivedFramePortsCurrentV1 } from '../../src/lightscaper/preview/photo-original-derived-frame-current-v1.ts';
import { rawRecoveryDngFixtureV1, type RawRecoveryOrientationV1 } from './lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './lightscaper-raw-worker-current-fixture.ts';
import { rawRecoveryWorkerFixtureV2 } from './lightscaper-raw-recovery-worker-current-fixture.ts';

let canonicalModule: Promise<WebAssembly.Module> | undefined, recoveryModule: Promise<WebAssembly.Module> | undefined;
function loadCanonical() {
	canonicalModule ??= readFile(new URL('../../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return canonicalModule;
}
function loadRecovery() {
	recoveryModule ??= readFile(process.env.LIGHTSCAPER_RECOVERY_WASM
		?? new URL('../../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawRecoveryModuleV2(new Uint8Array(bytes))); return recoveryModule;
}
export function rawDerivedOriginalFixtureCurrentV1(orientation: RawRecoveryOrientationV1 = 1) {
	const fixture = rawRecoveryDngFixtureV1({ orientation }), swapped = [5, 6, 7, 8].includes(orientation);
	const binding = Object.freeze({ catalogId: 'catalog-derived', photoId: 'photo-derived', originalId: 'original-derived', storageKey: 'media-derived',
		contentSha256: createHash('sha256').update(fixture.bytes).digest('hex'), byteLength: fixture.bytes.length,
		width: swapped ? fixture.height : fixture.width, height: swapped ? fixture.width : fixture.height });
	// The retained bytes, not this deliberately wrong MIME hint, identify RAW.
	return { ...fixture, binding, body: new Blob([fixture.bytes], { type: 'image/png' }) };
}

/** Only browser Worker transport is adapted; both jobs use the real compiled
 * production worker and manifest-pinned native WASM, never a pixel substitute. */
export async function rawDerivedOriginalNativeCurrentV1() {
	const canonical = await rawWorkerFixtureV1(), recovery = await rawRecoveryWorkerFixtureV2();
	const inputs: Uint8Array[] = [], words: ArrayBuffer[] = [], floats: ArrayBuffer[] = [], events: string[] = [];
	const hooks = { afterCanonical: async (): Promise<void> => undefined, current: async (): Promise<void> => undefined };
	const ports: PhotoOriginalDerivedFramePortsCurrentV1 = {
		async withRawFrame(request, consume) {
			assert.equal(this, ports); assert.ok(request && typeof request === 'object');
			const bytes: unknown = Reflect.get(request, 'bytes'); assert.ok(bytes instanceof Uint8Array); inputs.push(bytes);
			events.push('canonical-start');
			const result = await withDecodedRawOriginalV1(request, view => {
				assert.equal(canonical.active(), 0); words.push(view.frame.pixels.buffer); events.push('canonical-consume'); return consume(view);
			}, { loadModule: loadCanonical, createWorker: canonical.createWorker });
			assert.ok(words.every(buffer => new Uint8Array(buffer).every(value => value === 0))); events.push('canonical-retired');
			await hooks.afterCanonical(); return result;
		},
		withRecoveryFrame(request, consume) {
			assert.equal(this, ports); assert.equal(canonical.active(), 0); assert.ok(events.includes('canonical-retired'));
			assert.ok(words.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
			assert.ok(request && typeof request === 'object'); const bytes: unknown = Reflect.get(request, 'bytes');
			assert.ok(bytes instanceof Uint8Array); assert.equal(bytes, inputs[0]); inputs.push(bytes); events.push('recovery-start');
			return withDecodedRawRecoveryFrameV2(request, view => {
				assert.equal(recovery.active(), 0); floats.push(view.frame.pixels.buffer); events.push('recovery-consume'); return consume(view);
			}, { loadModule: loadRecovery, createWorker: recovery.createWorker });
		},
		async assertCurrent() { assert.equal(this, ports); await hooks.current(); },
	};
	return { ports, canonical, recovery, inputs, words, floats, events, hooks,
		async close() {
			const result = await Promise.allSettled([canonical.close(), recovery.close()]);
			const failures = result.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
			if (failures.length) throw new AggregateError(failures, 'Derived Original fixture retirement failed.');
		},
	};
}
