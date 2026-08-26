/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assistance custody does not revise the established native plug-in state wire. */
export {
	SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29 as SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V30,
	createSoundscaperNativePluginStateV29 as createSoundscaperNativePluginStateV30,
	normalizeSoundscaperNativePluginStatesV29 as normalizeSoundscaperNativePluginStatesV30,
} from './editor-native-plugin-state-v29.ts';

export type {
	SoundscaperNativePluginFormatV29 as SoundscaperNativePluginFormatV30,
	SoundscaperNativePluginStateBodyV29 as SoundscaperNativePluginStateBodyV30,
	SoundscaperNativePluginStateV29 as SoundscaperNativePluginStateV30,
} from './editor-native-plugin-state-v29.ts';
