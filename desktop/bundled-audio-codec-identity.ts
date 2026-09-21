/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-safe identity and provider descriptor for the seven reviewed bundled codecs. */

import type { BundledAudioCodecId } from './bundled-audio-codec-helper-configuration.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.ts';

interface BundledAudioCodecIdentityDescriptor {
	readonly stem: string;
	readonly implementation: string;
	readonly version: string;
	readonly wasmSha256: string;
}

export const BUNDLED_AUDIO_CODEC_IDENTITIES: Readonly<Record<
	BundledAudioCodecId, Readonly<BundledAudioCodecIdentityDescriptor>
>> = Object.freeze({
	flac: Object.freeze({ stem: 'libflac', implementation: 'libflac-wasm-f32-to-s24',
		version: '1.5.0', wasmSha256: '6246c5d6979f25b733e399383004a6a861478802c376d59885a7b2c7130a1584' }),
	lame: Object.freeze({ stem: 'lame', implementation: 'lame-wasm-f32-mp3',
		version: '4.0', wasmSha256: 'e8ca1786d95a56ead1fc2294be98ea68d31eed5837abd79d2a3322a0af946c6f' }),
	mpg123: Object.freeze({ stem: 'mpg123', implementation: 'libmpg123-wasm-feed-f32',
		version: 'mpg123-1.33.7', wasmSha256: '1aa30e6e25a9503be94ce3720ce6c4af649b2412c191a6f800f36dd619270bc2' }),
	opus: Object.freeze({ stem: 'libopus-libogg', implementation: 'libopus-libogg-wasm-f32',
		version: 'libopus-1.6.1+libogg-1.3.6', wasmSha256: 'cc5577fa2a6c74781b7eb57bd754f7d9b50b2355a83d85b0f0cfe96415607dce' }),
	twolame: Object.freeze({ stem: 'twolame', implementation: 'twolame-wasm-f32-mp2',
		version: '0.4.0', wasmSha256: '8b89b6a12eab302c92960865c6b1c7d33df86d6d8760c8549a8ee38a99ef2b30' }),
	vorbis: Object.freeze({ stem: 'libvorbis-libogg', implementation: 'libvorbis-libogg-wasm-f32',
		version: 'libvorbis-1.3.7+libogg-1.3.6', wasmSha256: 'cfa42717394ce29f8af676fb0ad7bff632306f75e536211eb85b7cc5aaf09aa0' }),
	wavpack: Object.freeze({ stem: 'wavpack', implementation: 'wavpack-wasm-f32',
		version: '5.9.0', wasmSha256: '5197fb8fd8e6cbef210acad11eb2a9dd8395a519b5fd64ba14a1b4978041b0c5' }),
});

export function bundledAudioCodecProviderIdentity(
	codec: BundledAudioCodecId,
	target: DesktopCodecTarget,
): Readonly<Pick<
	DesktopCodecProvider, 'kind' | 'id' | 'implementation' | 'version' | 'capabilityGeneration'
>> {
	const descriptor = BUNDLED_AUDIO_CODEC_IDENTITIES[codec];
	return Object.freeze({
		kind: 'bundled',
		id: `bundled-${descriptor.stem}-wasm-${target}`,
		implementation: descriptor.implementation,
		version: descriptor.version,
		capabilityGeneration: `${descriptor.stem}-${descriptor.wasmSha256}`,
	});
}

export function createBundledAudioCodecProvider(
	codec: BundledAudioCodecId,
	target: DesktopCodecTarget,
	policy: Readonly<{
		readonly matches: (operation: DesktopCodecOperation) => boolean;
		readonly unsupportedReason: string;
		readonly throwIfAborted: (signal?: AbortSignal) => void;
	}>,
): DesktopCodecProvider {
	return Object.freeze({
		...bundledAudioCodecProviderIdentity(codec, target),
		async preflight(operation: DesktopCodecOperation, options: Readonly<{ readonly signal?: AbortSignal }>) {
			policy.throwIfAborted(options?.signal);
			return policy.matches(operation)
				? Object.freeze({ disposition: 'supported' as const, reason: null })
				: Object.freeze({ disposition: 'unsupported' as const, reason: policy.unsupportedReason });
		},
	});
}
