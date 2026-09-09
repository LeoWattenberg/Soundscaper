/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useState } from 'react';
import { SKIN_IDS, normalizeSkin, type SkinId } from '../../skin-preferences.ts';
import { useEditorSkin } from './EditorSkinProvider.tsx';
import { SKINS } from './skin-themes.ts';
import { appearancePreview } from './appearance-previews.ts';
import type { AudioEditorWorkspaceRunner } from '../workspace/audio-editor-workspace-runner.ts';

export default function SkinPreferences({ controller, copy, run, savedSkin }: {
	controller: { actions: { preferences: { setSkin: (skin: SkinId) => unknown } } };
	copy: Record<string, string>;
	run: AudioEditorWorkspaceRunner;
	savedSkin?: unknown;
}) {
	const skin = useEditorSkin();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const effective = skin.preview ?? normalizeSkin(savedSkin);
	const name = (id: SkinId) => id === 'default' ? copy.skinDefault : SKINS[id].name;
	const select = (id: SkinId) => {
		setSaving(true);
		setError('');
		// Await the preference action itself: some workspace runners catch errors
		// for their toast and intentionally do not return the operation's result.
		const operation = skin.adopt(id, (value) => controller.actions.preferences.setSkin(value));
		run(() => operation);
		void operation.catch(() => { setError(copy.skinSaveError ?? 'Could not save the skin. Please try again.'); })
			.finally(() => { setSaving(false); });
	};
	return <section className="editor-skin-preferences" aria-label={copy.skin}>
		<h4>{copy.skin}</h4>
		<div className="editor-skin-choices">
			{SKIN_IDS.map((id) => {
				return <button type="button" key={id} className="editor-skin-choice" data-skin-choice={id}
					aria-pressed={effective === id} disabled={saving} onClick={() => { select(id); }}>
					<img className="editor-skin-swatch" src={appearancePreview(id, skin.mode)} alt="" />
					<span>{name(id)}</span>
				</button>;
			})}
		</div>
		{skin.preview !== null && <div className="editor-skin-preview-actions">
			<p role="status">{copy.skinPreview?.replace('{skin}', name(skin.preview) ?? skin.preview)}</p>
			<button type="button" disabled={saving} onClick={() => { select(effective); }}><span className="editor-skin-button-label">{copy.skinKeep}</span></button>
			<button type="button" disabled={saving} onClick={skin.end}><span className="editor-skin-button-label">{copy.skinEndPreview}</span></button>
		</div>}
		{error && <p role="alert">{error}</p>}
	</section>;
}
