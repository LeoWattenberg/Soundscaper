/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';

import type { AttributionReportPresentation } from './attribution-presentation-contract.ts';
import './audio-editor-design-system/06a-panels-freesound-attribution.css';

export type {
	AttributionMetadataPresentation,
	AttributionOccurrencePresentation,
	AttributionReportPresentation,
	AttributionSourcePresentation,
} from './attribution-presentation-contract.ts';

export interface AttributionTabProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly report?: AttributionReportPresentation | null;
	readonly onExportCsv?: () => void;
}

function LinkedValue({ value, url }: Readonly<{ value: string; url?: string }>) {
	return url
		? <a href={url} target="_blank" rel="noreferrer">{value}</a>
		: value;
}

export function AttributionTab({ copy, report, onExportCsv }: AttributionTabProps) {
	const occurrences = report?.occurrences ?? [];
	return (
		<section className="kw-audio-editor__attribution" data-attribution-tab="true">
			<div className="kw-audio-editor__attribution-heading">
				<p>{copy.intro}</p>
				<Button
					variant="secondary"
					size="small"
					disabled={!onExportCsv || occurrences.length === 0}
					onClick={() => onExportCsv?.()}
				>{copy.exportCsv}</Button>
			</div>
			{occurrences.length === 0 ? (
				<p className="kw-audio-editor__panel-empty">{copy.empty}</p>
			) : (
				<ol className="kw-audio-editor__attribution-occurrences">
					{occurrences.map((occurrence) => (
						<li key={occurrence.key} className="kw-audio-editor__attribution-occurrence">
							<h3>{occurrence.clipName}</h3>
							<dl className="kw-audio-editor__attribution-use">
								<div><dt>{copy.track}</dt><dd>{occurrence.projectBin ? copy.panelProjectBin : occurrence.trackName}</dd></div>
								{occurrence.projectBin ? null : (
									<div><dt>{copy.currentUse}</dt><dd>{occurrence.useTimeLabel}</dd></div>
								)}
							</dl>
							<h4>{copy.sources}</h4>
							<ul className="kw-audio-editor__attribution-sources">
								{occurrence.sources.map((source) => (
									<li key={source.key}>
										<strong><LinkedValue value={source.name} url={source.url} /></strong>
										{source.creator ? (
											<p>{copy.by}{' '}
												<LinkedValue value={source.creator} url={source.creatorUrl} />
											</p>
										) : null}
										{source.licenseName ? (
											<p>{copy.license}{': '}
												<LinkedValue value={source.licenseName} url={source.licenseUrl} />
											</p>
										) : null}
										{source.metadata.length > 0 ? (
											<details>
												<summary>{copy.importedMetadata}</summary>
												<dl className="kw-audio-editor__attribution-metadata">
													{source.metadata.map((field) => (
														<div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>
													))}
												</dl>
											</details>
										) : null}
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

export default AttributionTab;
