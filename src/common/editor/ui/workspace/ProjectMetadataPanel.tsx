import { useState } from 'react';

import AdmMetadataFields from '../AdmMetadataFields.tsx';
import BextMetadataFields from '../BextMetadataFields.tsx';
import MetadataEditorTabs, { type MetadataEditorTab } from '../MetadataEditorTabs.tsx';
import { createProjectAdmEditorValue } from '../adm-metadata-editor-model.ts';
import { createBextMetadataEditorValue } from '../bext-metadata-editor-model.ts';
import { MetadataEditorField } from './LabelManagerRows.jsx';

interface ProjectMetadataPanelProps {
	readonly project: Readonly<Record<string, unknown>> | null | undefined;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onUpdate: (changes: Readonly<Record<string, unknown>>) => void;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}

export function ProjectMetadataPanel({ project, copy, disabled, onUpdate }: ProjectMetadataPanelProps) {
	const [activeTab, setActiveTab] = useState<MetadataEditorTab>('general');
	const metadata = objectValue(project?.metadata);
	const tags = objectValue(metadata.tags);
	const bext = createBextMetadataEditorValue(project);
	const adm = createProjectAdmEditorValue(project);
	const fields = [
		['title', copy.metadataTitle],
		['artist', copy.metadataArtist],
		['album', copy.metadataAlbum],
		['trackNumber', copy.metadataTrack],
		['year', copy.metadataYear],
		['comments', copy.metadataComments],
	] as const;

	return (
		<div className="kw-audio-editor__metadata-editor" data-metadata-editor>
			<MetadataEditorTabs activeTab={activeTab} showBext showAdm copy={copy} onChange={setActiveTab} />
			<div
				role="tabpanel"
				aria-label={activeTab === 'bext'
					? copy.metadataBextTab
					: activeTab === 'adm' ? copy.metadataAdmTab : copy.metadataGeneralTab}
				data-metadata-tab={activeTab}
			>
				{activeTab === 'general' ? (
					<div className="kw-audio-editor__metadata-list">
						{fields.map(([key, label]) => (
							<MetadataEditorField
								key={key}
								name={key}
								label={label}
								value={String(metadata[key] || '')}
								disabled={disabled}
								onCommit={(value: string) => onUpdate({ [key]: value })}
							/>
						))}
						{Object.entries(tags).map(([key, value]) => (
							<MetadataEditorField
								key={key}
								name={`tag-${key}`}
								label={key}
								value={String(value || '')}
								disabled={disabled}
								onCommit={(nextValue: string) => onUpdate({
									tags: { ...tags, [key]: nextValue },
								})}
							/>
						))}
					</div>
				) : activeTab === 'bext' ? (
					<BextMetadataFields
						value={bext}
						copy={copy}
						disabled={disabled}
						onCommit={(value) => onUpdate({ bext: value })}
					/>
				) : (
					<AdmMetadataFields
						value={adm}
						project={project}
						copy={copy}
						disabled={disabled}
						onCommit={(value) => onUpdate({ adm: value })}
					/>
				)}
			</div>
		</div>
	);
}

export default ProjectMetadataPanel;
