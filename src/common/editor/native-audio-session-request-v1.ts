/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The session a caller asks the milestone-5A native audio tier to open.
 *
 * The rest of the renderer's view of that tier is a projection of the preload
 * bridge and belongs with the surfaces that read it, but this request shape is
 * named on both sides of the boundary: `soundscaper-native-audio-renderer.ts`
 * builds one to hand the realtime client, and it is editor domain code that no
 * presentation module should have to be loaded for. So the shape is declared
 * here and `ui/soundscaper-native-services-bridge.ts` re-exports it, leaving
 * every surface that already imports it from the bridge unchanged.
 */

export interface NativeAudioSessionOpenRequestV1 {
	readonly candidates: readonly Readonly<{
		readonly backend: 'coreaudio' | 'wasapi' | 'asio' | 'pipewire' | 'alsa' | 'jack';
		readonly deviceHandle: string;
	}>[];
	readonly direction: 'input' | 'output' | 'duplex';
	readonly mode: 'shared' | 'exclusive';
	readonly sampleRate: number;
	readonly periodFrames: number;
	readonly channelCount: number;
}
