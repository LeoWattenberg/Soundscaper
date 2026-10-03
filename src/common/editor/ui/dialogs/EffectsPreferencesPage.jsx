/* SPDX-License-Identifier: AGPL-3.0-only */

import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { lazy, Suspense } from 'react';

import PreferenceDropdownField from './PreferenceDropdownField.jsx';

const PluginFoldersPreferences = lazy(() => import('./SoundscaperPluginFoldersPreferences.tsx'));

export default function EffectsPreferencesPage({ controller, snapshot, copy, run, productId = 'soundscaper' }) {
	return (
		<>
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
		<Suspense fallback={null}>
			<PluginFoldersPreferences productId={productId} copy={copy} />
		</Suspense>
		</>
	);
}
