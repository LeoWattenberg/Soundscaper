import { Suspense, useState } from 'react';

import type { AttributionCsvFileService } from '../attribution-presentation-contract.ts';
import AdmMetadataFields from '../AdmMetadataFields.tsx';
import BextMetadataFields from '../BextMetadataFields.tsx';
import MetadataEditorTabs, { type MetadataEditorTab } from '../MetadataEditorTabs.tsx';
import { createProjectAdmEditorValue } from '../adm-metadata-editor-model.ts';
import { createBextMetadataEditorValue } from '../bext-metadata-editor-model.ts';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { freesoundAttributionCopy } from '../../../i18n/freesound-attribution-copy.js';
import { MetadataEditorField } from './LabelManagerRows.jsx';

const ProjectAttributionTab = lazyEditorModule(() => import('./ProjectAttributionTab.tsx'));

export interface ProjectMetadataPanelProps {
	readonly project: Readonly<Record<string, unknown>> | null | undefined;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: string;
	readonly disabled: boolean;
	readonly onUpdate: (changes: Readonly<Record<string, unknown>>) => void;
	readonly fileService?: AttributionCsvFileService | null;
	readonly run?: (operation: () => unknown) => unknown;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}

export function ProjectMetadataPanel({
	project,
	copy,
	locale,
	disabled,
	onUpdate,
	fileService,
	run,
}: ProjectMetadataPanelProps) {
	const [activeTab, setActiveTab] = useState<MetadataEditorTab>('general');
	const metadata = objectValue(project?.metadata);
	const tags = objectValue(metadata.tags);
	const bext = createBextMetadataEditorValue(project);
	const adm = createProjectAdmEditorValue(project);
	const attributionTabLabel = freesoundAttributionCopy(locale, copy).metadataTab;
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
			<MetadataEditorTabs
				activeTab={activeTab}
				showBext
				showAdm
				showAttribution
				attributionLabel={attributionTabLabel}
				copy={copy}
				onChange={setActiveTab}
			/>
			<div
				role="tabpanel"
				aria-label={activeTab === 'bext'
					? copy.metadataBextTab
					: activeTab === 'adm'
						? copy.metadataAdmTab
						: activeTab === 'attribution' ? attributionTabLabel : copy.metadataGeneralTab}
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
				) : activeTab === 'adm' ? (
					<AdmMetadataFields
						value={adm}
						project={project}
						copy={copy}
						disabled={disabled}
						onCommit={(value) => onUpdate({ adm: value })}
					/>
				) : (
					<Suspense fallback={<p role="status" aria-live="polite">{copy.loading}</p>}>
						<ProjectAttributionTab
							project={project}
							copy={copy}
							locale={locale}
							fileService={fileService}
							run={run}
						/>
					</Suspense>
				)}
			</div>
		</div>
	);
}

export default ProjectMetadataPanel;
