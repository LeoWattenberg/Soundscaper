/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import { AudioDevicesFlyout } from '../toolbar/AudioEditorMeterControls.jsx';

/**
 * Audacity's Audio settings preferences page: the playback and recording
 * devices, reached from Preferences as well as from the transport's Audio
 * setup button.
 *
 * Audacity's page leads with an audio API choice. This editor has none to
 * offer — the browser has only Web Audio, and the desktop backend chain is
 * discovered rather than chosen — so the page begins at the devices.
 */
export default function AudioSettingsPreferencesPage({ controller, snapshot, copy, run }) {
	return (
		<PreferencePanel title={copy.preferencesAudioSettings}>
			<AudioDevicesFlyout
				copy={copy}
				snapshot={snapshot}
				controller={controller}
				run={run}
				heading={false}
			/>
		</PreferencePanel>
	);
}
