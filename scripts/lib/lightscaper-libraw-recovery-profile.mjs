/* SPDX-License-Identifier: AGPL-3.0-only */

export const RECOVERY_ABI_EXPORTS_V2 = Object.freeze([
	'memory', '_initialize', 'raw_abi_version', 'raw_profile_version', 'raw_input_alloc', 'raw_open', 'raw_decode',
	'raw_output_ptr', 'raw_output_bytes', 'raw_output_width', 'raw_output_height', 'raw_output_channels', 'raw_output_bits',
	'raw_flip', 'raw_highlight_mode', 'raw_exposure_scale', 'raw_destroy',
]);
export const RECOVERY_ABI_IMPORTS_V2 = Object.freeze([
	'env.emscripten_notify_memory_growth', 'wasi_snapshot_preview1.fd_read', 'wasi_snapshot_preview1.fd_write',
	'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_seek',
]);
const PROFILES = [{ id: 'linear-headroom-v1', highlightMode: 1 }, { id: 'highlight-recovery-v1', highlightMode: 3 }];
const PROCESSING = Object.freeze({
	normalization: 'inverse-min-normalized-premul', workingSpace: 'linear-srgb-float32', orientation: 'native-flip-applied',
	adjustMaximumThreshold: .75, demosaicQuality: 3, autoBright: false, autoWhiteBalance: false, cameraWhiteBalance: false,
	minimumSidePixels: 16, maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumInputBytes: 64 * 1024 * 1024,
	maximumDecodedBytes: 256 * 1024 * 1024, maximumDecodeWorkingBytes: 1024 * 1024 * 1024, maximumExposureScale: 65_536,
});
const sameNames = (left, right) => Array.isArray(left) && left.length === right.length
	&& JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const sameRecord = (value, expected) => value && Object.keys(value).length === Object.keys(expected).length
	&& Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);

/** Fixed native processing authority, independent of a manifest's byte pins.
 * The separate ABI1 closure never participates in bootstrap mutation. */
export function assertLibRawRecoveryProfileV2(manifest, { bootstrap = false } = {}) {
	if (manifest.schemaVersion !== 2 || manifest.profileVersion !== 1
		|| !Array.isArray(manifest.profiles) || manifest.profiles.length !== PROFILES.length
		|| !PROFILES.every((profile, index) => sameRecord(manifest.profiles[index], profile))
		|| !sameRecord(manifest.processing, PROCESSING)) {
		throw new Error('LibRaw recovery requires the fixed ABI2 headroom/reconstruction profile version1.');
	}
	if (manifest.bridge?.path !== 'src/common/editor/raw/native/libraw_recovery_wasm.cpp'
		|| manifest.buildRecipe?.path !== 'scripts/build-lightscaper-libraw-recovery-wasm.mjs'
		|| manifest.runtime?.path !== 'runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
		|| manifest.runtime?.url !== 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
		|| !sameNames(manifest.wasm?.requiredExports, RECOVERY_ABI_EXPORTS_V2)
		|| !sameRecord(manifest.wasm?.auxiliaryExports, { __indirect_function_table: 'table', __trap: 'function' })) {
		throw new Error('LibRaw recovery publication and exact ABI2 export inventory changed.');
	}
	if (!sameNames(manifest.wasm?.allowedImports, bootstrap ? [] : RECOVERY_ABI_IMPORTS_V2)) {
		throw new Error('LibRaw recovery requires its exact reviewed function import inventory.');
	}
}
