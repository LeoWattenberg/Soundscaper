/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { formatLocalizedTemplate, formatResizeLabel } from '../localization-template.ts';

export default function ScapeOpenDecisionDialog({ copy, prompt, onSettle }) {
	const descriptionId = React.useId();
	const compatibility = prompt.kind !== 'collision';
	const collision = prompt.kind !== 'compatibility';
	const report = compatibility ? prompt.inspected.featureRequirementsCompatibility : null;
	const affectedItems = (report?.items || []).filter((item) => item.availability !== 'available');
	const title = compatibility ? copy.scapeCompatibilityTitle : copy.scapeCollisionTitle;
	const initialFocus = compatibility
		? '.audio-editor-scape-open-cancel'
		: '.audio-editor-scape-collision-copy';
	return (
		<AudioEditorDialogShell
			title={title}
			className="audio-editor-scape-open-decision"
			resizeLabel={formatResizeLabel(copy, title)}
			onClose={() => onSettle(prompt, 'cancel')}
			initialFocus={initialFocus}
			ariaDescribedBy={descriptionId}
			dataAttributes={{ 'data-scape-open-decision': prompt.kind }}
			footer={<DialogFooter
				className="audio-editor-dialog-footer"
				rightContent={<>
					<Button
						className="audio-editor-scape-open-cancel"
						variant="secondary"
						onClick={() => onSettle(prompt, 'cancel')}
					>
						{copy.cancel}
					</Button>
					{prompt.kind === 'collision' ? (
						<Button
							className="audio-editor-scape-collision-copy"
							variant="primary"
							onClick={() => onSettle(prompt, 'copy')}
						>
							{copy.scapeOpenAsCopy}
						</Button>
					) : (
						<Button variant="primary" onClick={() => onSettle(
							prompt,
							prompt.kind === 'compatibility' ? 'open-read-only' : 'copy-read-only',
						)}>
							{prompt.kind === 'compatibility' ? copy.scapeOpenReadOnly : copy.scapeOpenReadOnlyCopy}
						</Button>
					)}
				</>}
			/>}
		>
			<div id={descriptionId}>
				{compatibility && (
					<p>{formatLocalizedTemplate(copy.scapeCompatibilityMessage, {
						title: prompt.inspected.title,
					})}</p>
				)}
				{collision && (
					<p>{formatLocalizedTemplate(copy.scapeCollisionMessage, {
						title: prompt.inspected.title,
					})}</p>
				)}
			</div>
			{compatibility && (
				<>
					<dl className="kw-audio-editor-compatibility-counts">
						<div><dt>{copy.scapeCompatibilityUnavailable}</dt><dd>{report?.counts?.unavailable || 0}</dd></div>
						<div><dt>{copy.scapeCompatibilityUnknown}</dt><dd>{report?.counts?.unknown || 0}</dd></div>
					</dl>
					<h3>{copy.scapeCompatibilityAffectedFeatures}</h3>
					<ul className="kw-audio-editor-compatibility-items" data-scape-feature-requirements>
						{affectedItems.map((item) => (
							<li key={item.requirementId} data-severity="warning" data-scape-feature-requirement={item.featureId}>
								<strong>{item.displayName}</strong>
								<small>{item.featureId}</small>
								<small>{availabilityCopy(item.availability, copy)} · {dispositionCopy(item.declaredDisposition, copy)}</small>
							</li>
						))}
					</ul>
				</>
			)}
		</AudioEditorDialogShell>
	);
}

function availabilityCopy(availability, copy) {
	return availability === 'unknown'
		? copy.scapeCompatibilityUnknown
		: copy.scapeCompatibilityUnavailable;
}

function dispositionCopy(declaredDisposition, copy) {
	return declaredDisposition === 'rendered-fallback'
		? copy.scapeCompatibilityRenderedFallback
		: copy.scapeCompatibilityBypassed;
}
