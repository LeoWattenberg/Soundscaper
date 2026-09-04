/* SPDX-License-Identifier: AGPL-3.0-only */

/** Static main-safe provider identities for bundled codecs executed only in utility processes. */

import type { BundledAudioCodecId } from './bundled-audio-codec-helper-configuration.js';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.js';
import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.js';

interface ProviderDescriptor {
	readonly id: (target: DesktopCodecTarget) => string;
	readonly implementation: string;
	readonly version: string;
	readonly capabilityGeneration: string;
	readonly unsupportedReason: string;
}

const DESCRIPTORS: Readonly<Record<BundledAudioCodecId, Readonly<ProviderDescriptor>>> = Object.freeze({
	flac: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-libflac-wasm-${target}`,
		implementation: 'libflac-wasm-f32-to-s24', version: '1.5.0',
		capabilityGeneration: 'libflac-0f703571f95e37c24ad68577163ea56b4a9dd7d5576760700b482369e924f986',
		unsupportedReason: 'The bundled libFLAC payload supports bounded f32 decode and signed-24 encode only.',
	}),
	lame: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-lame-wasm-${target}`,
		implementation: 'lame-wasm-f32-mp3', version: '4.0',
		capabilityGeneration: 'lame-d624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123',
		unsupportedReason: 'The bundled LAME payload supports bounded MP3 encoding only.',
	}),
	mpg123: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-mpg123-wasm-${target}`,
		implementation: 'libmpg123-wasm-feed-f32', version: 'mpg123-1.33.7',
		capabilityGeneration: 'mpg123-d2b5686a16141ec97dbeb4e4f2a1ce28b756dd3eaf6438b31379356c8dd958ae',
		unsupportedReason: 'The bundled mpg123 payload supports bounded MPEG Layer II/III decoding only.',
	}),
	opus: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-libopus-libogg-wasm-${target}`,
		implementation: 'libopus-libogg-wasm-f32', version: 'libopus-1.6.1+libogg-1.3.6',
		capabilityGeneration: 'libopus-libogg-c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853',
		unsupportedReason: 'The bundled libopus/libogg payload supports 48 kHz family-0 mono/stereo only.',
	}),
	twolame: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-twolame-wasm-${target}`,
		implementation: 'twolame-wasm-f32-mp2', version: '0.4.0',
		capabilityGeneration: 'twolame-b4b166bed688504b548adcee02cda391d4d8b25a44aec914c3fe1082f466ed1b',
		unsupportedReason: 'The bundled TwoLAME payload supports bounded MP2 encoding only.',
	}),
	vorbis: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-libvorbis-libogg-wasm-${target}`,
		implementation: 'libvorbis-libogg-wasm-f32', version: 'libvorbis-1.3.7+libogg-1.3.6',
		capabilityGeneration: 'libvorbis-libogg-c03037c33f35dbf85e1e963058156399b995b2dedb5479f6eb3f3b30148eeee5',
		unsupportedReason: 'The bundled libvorbis/libogg payload supports bounded Ogg Vorbis audio only.',
	}),
	wavpack: Object.freeze({
		id: (target: DesktopCodecTarget) => `bundled-wavpack-wasm-${target}`,
		implementation: 'wavpack-wasm-f32', version: '5.9.0',
		capabilityGeneration: 'wavpack-c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
		unsupportedReason: 'The bundled WavPack payload supports only bounded float32 WavPack audio.',
	}),
});

export function createIsolatedBundledAudioCodecProvider(
	codec: BundledAudioCodecId,
	target: DesktopCodecTarget,
): DesktopCodecProvider {
	const descriptor = DESCRIPTORS[codec];
	return Object.freeze({
		kind: 'bundled', id: descriptor.id(target), implementation: descriptor.implementation,
		version: descriptor.version, capabilityGeneration: descriptor.capabilityGeneration,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			if (options?.signal?.aborted) throw abortReason(options.signal);
			return operationMatches(codec, operation)
				? Object.freeze({ disposition: 'supported', reason: null })
				: Object.freeze({ disposition: 'unsupported', reason: descriptor.unsupportedReason });
		},
	});
}

export function bundledAudioCodecIdForOperation(
	operation: DesktopCodecOperation,
): BundledAudioCodecId | null {
	for (const codec of Object.keys(DESCRIPTORS) as BundledAudioCodecId[]) {
		if (operationMatches(codec, operation)) return codec;
	}
	return null;
}

function operationMatches(codec: BundledAudioCodecId, operation: DesktopCodecOperation): boolean {
	if (!operation || operation.mediaKind !== 'audio'
		|| operation.pixelFormat !== null || operation.width !== null || operation.height !== null
		|| operation.profile !== null || operation.direction !== 'decode' && operation.direction !== 'encode') {
		return false;
	}
	const direction = operation.direction;
	const geometry = direction === 'decode'
		? operation.sampleRate === null && operation.channelCount === null
		: Number.isSafeInteger(operation.sampleRate) && operation.sampleRate! >= 8_000
			&& operation.sampleRate! <= 192_000 && Number.isSafeInteger(operation.channelCount)
			&& operation.channelCount! >= 1 && operation.channelCount! <= 8;
	if (!geometry) return false;
	if (codec === 'flac') return operation.container === 'flac' && operation.codec === 'flac'
		&& operation.sampleFormat === (direction === 'encode' ? 's24' : 'f32');
	if (codec === 'lame') return direction === 'encode' && operation.container === 'mp3'
		&& operation.codec === 'mp3' && operation.sampleFormat === 'f32p';
	if (codec === 'mpg123') return direction === 'decode'
		&& (operation.container === 'mp3' && operation.codec === 'mp3'
			|| operation.container === 'mp2' && operation.codec === 'mp2')
		&& operation.sampleFormat === 'f32';
	if (codec === 'opus') return operation.container === 'ogg' && operation.codec === 'opus'
		&& operation.sampleFormat === 'f32p';
	if (codec === 'twolame') return direction === 'encode' && operation.container === 'mp2'
		&& operation.codec === 'mp2' && operation.sampleFormat === 'f32p';
	if (codec === 'vorbis') return operation.container === 'ogg' && operation.codec === 'vorbis'
		&& operation.sampleFormat === 'f32p';
	return operation.container === 'wavpack' && operation.codec === 'wavpack'
		&& operation.sampleFormat === 'f32';
}

function abortReason(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException('The isolated bundled codec preflight was cancelled.', 'AbortError');
}
