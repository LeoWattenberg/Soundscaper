/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { TextInput } from '@soundscaper/design-system/TextInput';

import AdmMetadataFields from '../AdmMetadataFields.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import BextMetadataFields from '../BextMetadataFields.tsx';
import MetadataEditorTabs from '../MetadataEditorTabs.tsx';

const METADATA_FIELDS = Object.freeze(['metadataTitle', 'metadataArtist', 'metadataAlbum', 'metadataTrack', 'metadataYear', 'metadataGenre', 'metadataComments', 'metadataCopyright']);

/**
 * The export dialog's metadata editor, which replaces the dialog's own body
 * while it is open rather than opening a second window over it.
 */
export default function ExportDialogMetadataPanel({
	isOpen, copy, format, project, settings, activeTab, onTabChange, onChange, onClose,
}) {
	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.metadata}
			onClose={() => onClose()}
			width={760}
			className="audio-editor-metadata-dialog"
			dataAttributes={{ 'data-export-metadata-dialog': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					rightContent={<Button variant="primary" onClick={() => onClose()}>{copy.done}</Button>}
				/>
			)}
		>
			<section className="audio-editor-metadata-editor">
				<MetadataEditorTabs
					activeTab={activeTab}
					showBext={['bwf', 'bw64'].includes(format)}
					showAdm={format === 'bw64'}
					copy={copy}
					onChange={onTabChange}
				/>
				<div
					role="tabpanel"
					aria-label={activeTab === 'bext'
						? copy.metadataBextTab
						: activeTab === 'adm' ? copy.metadataAdmTab : copy.metadataGeneralTab}
					data-export-metadata-tab={activeTab}
				>
					{activeTab === 'bext' ? (
						<>
							<p className="audio-editor-panel-hint">{copy.bextExportHint}</p>
							<BextMetadataFields
								value={settings.bext}
								copy={copy}
								onCommit={(value) => onChange('bext', value)}
							/>
						</>
					) : activeTab === 'adm' ? (
						<>
							<p className="audio-editor-panel-hint">{copy.admExportHint}</p>
							<AdmMetadataFields
								value={settings.adm}
								project={project}
								copy={copy}
								onCommit={(value) => onChange('adm', value)}
							/>
						</>
					) : (
						<>
							<div className="audio-editor-metadata-table" role="table" aria-label={copy.metadata}>
								<div className="audio-editor-metadata-table__header" role="row">
									<span role="columnheader">{copy.metadataTagColumn}</span>
									<span role="columnheader">{copy.metadataValueColumn}</span>
								</div>
								{METADATA_FIELDS.map((name) => (
									<label className="audio-editor-metadata-table__row" role="row" key={name}>
										<span role="cell">{copy[name]}</span>
										<span role="cell"><TextInput multiline={name === 'metadataComments'} value={settings[name]} onChange={(value) => onChange(name, value)} width="100%" /></span>
									</label>
								))}
							</div>
							<details className="audio-editor-export-details">
								<summary>{copy.customMetadata}</summary>
								<label className="audio-editor-field">
									<span>{copy.customMetadata}</span>
									<TextInput multiline value={settings.metadataCustom} onChange={(value) => onChange('metadataCustom', value)} width="100%" />
								</label>
							</details>
						</>
					)}
				</div>
			</section>
		</AudioEditorDialogShell>
	);
}
