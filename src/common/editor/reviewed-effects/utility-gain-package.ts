/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	REVIEWED_EFFECT_ABI_SCHEMA,
	REVIEWED_EFFECT_ABI_VERSION,
	REVIEWED_EFFECT_MANIFEST_SCHEMA,
	REVIEWED_EFFECT_LATENCY_EXPORT,
	REVIEWED_EFFECT_MEMORY_EXPORT,
	REVIEWED_EFFECT_PROCESS_EXPORT,
	REVIEWED_EFFECT_TAIL_EXPORT,
	REVIEWED_EFFECT_VERSION_EXPORT,
	defineReviewedEffectManifest,
} from './manifest.ts';

export const UTILITY_GAIN_PACKAGE_ID = 'org.soundscaper.utility-gain';
export const UTILITY_GAIN_PACKAGE_VERSION = '1.0.0';
export const UTILITY_GAIN_PACKAGE_SHA256 = 'c2a7180c9ba2da9fa39297c158880ebf9c1291dee1fe9c77ed0c3fa018a2b0cd';

export const UTILITY_GAIN_MANIFEST = defineReviewedEffectManifest({
	schema: REVIEWED_EFFECT_MANIFEST_SCHEMA,
	id: UTILITY_GAIN_PACKAGE_ID,
	version: UTILITY_GAIN_PACKAGE_VERSION,
	displayName: 'Utility Gain',
	abi: {
		schema: REVIEWED_EFFECT_ABI_SCHEMA,
		version: REVIEWED_EFFECT_ABI_VERSION,
		inputLayout: 'planar',
		sampleFormat: 'f32',
		processExport: REVIEWED_EFFECT_PROCESS_EXPORT,
		memoryExport: REVIEWED_EFFECT_MEMORY_EXPORT,
		versionExport: REVIEWED_EFFECT_VERSION_EXPORT,
		latencyFramesExport: REVIEWED_EFFECT_LATENCY_EXPORT,
		tailFramesExport: REVIEWED_EFFECT_TAIL_EXPORT,
	},
	parameters: [{
		id: 'gain',
		index: 0,
		defaultValue: 1,
		minimum: 0,
		maximum: 4,
	}],
	resources: {
		maximumModuleBytes: 4_096,
		maximumMemoryPages: 1,
		maximumChannels: 2,
		maximumBlockFrames: 2_048,
		maximumInputBytes: 16_384,
		maximumOutputBytes: 16_384,
		processingTimeoutMs: 250,
	},
	latencyFrames: 0,
	tailFrames: 0,
});

// Repository-owned conformance module. Its sole process export multiplies
// planar f32 input by parameter zero and writes the same shape to output.
const UTILITY_GAIN_WASM_BYTES = Uint8Array.of(
	0, 97, 115, 109, 1, 0, 0, 0, 1, 12, 1, 96, 7, 127, 127, 127, 127, 125, 127, 127, 1, 127,
	3, 2, 1, 0, 5, 4, 1, 1, 1, 1, 6, 16, 3, 127, 0, 65, 1, 11, 127, 0, 65, 0, 11, 127, 0,
	65, 0, 11, 7, 141, 1, 5, 6, 109, 101, 109, 111, 114, 121, 2, 0, 30, 115, 111, 117, 110, 100,
	115, 99, 97, 112, 101, 114, 95, 101, 102, 102, 101, 99, 116, 95, 97, 98, 105, 95, 118, 101, 114,
	115, 105, 111, 110, 3, 0, 33, 115, 111, 117, 110, 100, 115, 99, 97, 112, 101, 114, 95, 101, 102,
	102, 101, 99, 116, 95, 108, 97, 116, 101, 110, 99, 121, 95, 102, 114, 97, 109, 101, 115, 3, 1,
	30, 115, 111, 117, 110, 100, 115, 99, 97, 112, 101, 114, 95, 101, 102, 102, 101, 99, 116, 95,
	116, 97, 105, 108, 95, 102, 114, 97, 109, 101, 115, 3, 2, 26, 115, 111, 117, 110, 100, 115, 99,
	97, 112, 101, 114, 95, 101, 102, 102, 101, 99, 116, 95, 112, 114, 111, 99, 101, 115, 115, 0, 0,
	10, 108, 1, 106, 2, 2, 127, 1, 125, 32, 2, 65, 0, 72, 4, 64, 65,
	127, 15, 11, 32, 3, 65, 1, 72, 4, 64, 65, 127, 15, 11, 32, 6, 65, 1, 71, 4, 64, 65, 127,
	15, 11, 32, 5, 42, 2, 0, 33, 9, 32, 2, 32, 3, 108, 33, 7, 65, 0, 33, 8, 2, 64, 3, 64,
	32, 8, 32, 7, 79, 13, 1, 32, 1, 32, 8, 65, 2, 116, 106, 32, 0, 32, 8, 65, 2, 116, 106,
	42, 2, 0, 32, 9, 148, 56, 2, 0, 32, 8, 65, 1, 106, 33, 8, 12, 0, 11, 11, 65, 0, 11,
);

/** Return a new buffer so the release-pinned artifact cannot be mutated. */
export function utilityGainPackageBytes(): Uint8Array {
	return UTILITY_GAIN_WASM_BYTES.slice();
}
