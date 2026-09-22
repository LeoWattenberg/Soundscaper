/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalCopyValue } from '../../../i18n/canonical-extras.js';
import { formatLocalizedTemplate } from '../localization-template.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { EffectAboutMetadata } from './effect-about-metadata.ts';

const FIELD_COPY_KEYS = {
	format: 'effectAboutFormat',
	author: 'effectAboutAuthor',
	version: 'effectAboutVersion',
	license: 'effectAboutLicense',
	installPath: 'effectAboutInstallPath',
	category: 'effectAboutCategory',
	source: 'effectAboutSource',
	identifier: 'effectAboutIdentifier',
	copyright: 'effectAboutCopyright',
	compatibility: 'effectAboutCompatibility',
	latency: 'effectAboutLatency',
} as const;

export default function EffectAboutDialog({ about, copy, onClose }: {
	readonly about: EffectAboutMetadata;
	readonly copy: Readonly<Record<string, string>>;
	readonly onClose: () => void;
}) {
	const title = formatLocalizedTemplate(canonicalCopyValue('effectAboutTitle', copy), { name: about.title });
	return <AudioEditorDialogShell isOpen title={title} onClose={onClose} width={480}
		className="audio-editor-effect-about-dialog" dataAttributes={{ 'data-effect-about-dialog': '' }}>
		<dl className="audio-editor-effect-about-fields">
			{about.fields.map(({ key, value }) => <div key={key} className="audio-editor-effect-about-field">
				<dt>{canonicalCopyValue(FIELD_COPY_KEYS[key], copy)}</dt>
				<dd>{value}</dd>
			</div>)}
		</dl>
	</AudioEditorDialogShell>;
}
