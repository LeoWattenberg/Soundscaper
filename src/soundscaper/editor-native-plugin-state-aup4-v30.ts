/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29,
	SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V29,
	embedSoundscaperNativePluginStatesInAup4V29,
	recoverSoundscaperNativePluginStatesFromAup4V29,
	type SoundscaperAup4NativePluginStateStoreV29,
} from './editor-native-plugin-state-aup4-v29.ts';
import {
	borrowSoundscaperProjectV29FromV30,
	restoreSoundscaperProjectV30FromV29,
} from './editor-project-v30-foundation.ts';
import type { SoundscaperProjectV30 } from './editor-project-v30.ts';

export const SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V30 =
	SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_NODE_V29;
export const SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V30 =
	SOUNDSCAPER_AUP4_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V29;

export type SoundscaperAup4NativePluginStateStoreV30 =
	SoundscaperAup4NativePluginStateStoreV29;

/** Embed unchanged native state while retaining V30 assistance references. */
export async function embedSoundscaperNativePluginStatesInAup4V30(
	projectValue: SoundscaperProjectV30 | unknown,
	store: SoundscaperAup4NativePluginStateStoreV30,
): Promise<SoundscaperProjectV30> {
	const borrowed = borrowSoundscaperProjectV29FromV30(projectValue);
	const embedded = await embedSoundscaperNativePluginStatesInAup4V29(borrowed.project, store);
	return restoreSoundscaperProjectV30FromV29(embedded, borrowed.assistanceAssets);
}

/** Recover unchanged native state while retaining V30 assistance references. */
export async function recoverSoundscaperNativePluginStatesFromAup4V30(
	projectValue: SoundscaperProjectV30 | unknown,
	store: SoundscaperAup4NativePluginStateStoreV30,
): Promise<SoundscaperProjectV30> {
	const borrowed = borrowSoundscaperProjectV29FromV30(projectValue);
	const recovered = await recoverSoundscaperNativePluginStatesFromAup4V29(borrowed.project, store);
	return restoreSoundscaperProjectV30FromV29(recovered, borrowed.assistanceAssets);
}
