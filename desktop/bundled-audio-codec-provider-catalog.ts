/* SPDX-License-Identifier: AGPL-3.0-only */

/** Static main-safe provider identities for bundled codecs executed only in utility processes. */

import type { BundledAudioCodecId } from './bundled-audio-codec-helper-configuration.js';
import {
	BUNDLED_AUDIO_CODEC_IDENTITIES,
	createBundledAudioCodecProvider,
} from './bundled-audio-codec-identity.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.js';
import type { DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.js';

const UNSUPPORTED_REASONS: Readonly<Record<BundledAudioCodecId, string>> = Object.freeze({
	flac: 'The bundled libFLAC payload supports bounded f32 decode and signed-24 encode only.',
	lame: 'The bundled LAME payload supports bounded MP3 encoding only.',
	mpg123: 'The bundled mpg123 payload supports bounded MPEG Layer II/III decoding only.',
	opus: 'The bundled libopus/libogg payload supports 48 kHz family-0 mono/stereo only.',
	twolame: 'The bundled TwoLAME payload supports bounded MP2 encoding only.',
	vorbis: 'The bundled libvorbis/libogg payload supports bounded Ogg Vorbis audio only.',
	wavpack: 'The bundled WavPack payload supports only bounded float32 WavPack audio.',
});

export function createIsolatedBundledAudioCodecProvider(
	codec: BundledAudioCodecId,
	target: DesktopCodecTarget,
): DesktopCodecProvider {
	return createBundledAudioCodecProvider(codec, target, {
		matches: (operation) => operationMatches(codec, operation),
		unsupportedReason: UNSUPPORTED_REASONS[codec],
		throwIfAborted: (signal) => { if (signal?.aborted) throw abortReason(signal); },
	});
}

export function bundledAudioCodecIdForOperation(
	operation: DesktopCodecOperation,
): BundledAudioCodecId | null {
	for (const codec of Object.keys(BUNDLED_AUDIO_CODEC_IDENTITIES) as BundledAudioCodecId[]) {
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
