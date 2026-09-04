/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import PreferenceDropdownField from './PreferenceDropdownField.jsx';

/**
 * Audacity's Effects preferences page.
 *
 * Audacity 4 lists the page without a body; Audacity 3's page is mostly plug-in
 * providers, scanning and the plug-in manager, which this editor keeps behind
 * its own native-services surface. What survives the port is the one setting
 * that governs an editor this size: how the Effect menu is arranged.
 */
export default function EffectsPreferencesPage({ controller, snapshot, copy, run }) {
	return (
		<PreferencePanel title={copy.effectOptions}>
			<div className="kw-audio-editor-preferences__grid">
				<PreferenceDropdownField
					label={copy.effectMenuOrganization}
					value={snapshot.preferences.effects?.menuOrganization || 'default'}
					onChange={(value) => run(() => controller.actions.preferences.update({
						effects: { menuOrganization: value },
					}))}
					options={[
						{ value: 'default', label: copy.effectGroupByCategory },
						{ value: 'sortby:name', label: copy.effectSortByName },
					]}
				/>
			</div>
		</PreferencePanel>
	);
}
