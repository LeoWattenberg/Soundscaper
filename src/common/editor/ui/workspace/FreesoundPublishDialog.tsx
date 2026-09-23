/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { type FormEvent, useEffect, useId, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { FREESOUND_BROAD_SOUND_TAXONOMY } from '../../freesound-upload-metadata.ts';
import type { FreesoundPublishLicense } from './freesound-auth-upload-client.ts';
import type { FreesoundPublishDraft, FreesoundUploadItem } from './freesound-upload-queue.ts';

export interface FreesoundPublishDialogProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly item: FreesoundUploadItem;
	readonly onClose: () => void;
	readonly onPublish: (id: string, draft: FreesoundPublishDraft) => Promise<void> | void;
}

const LICENSES: readonly FreesoundPublishLicense[] = Object.freeze([
	'cc-by', 'cc0', 'cc-by-nc',
]);
const TAXONOMY_COPY_KEY_BY_ID = Object.freeze({
	'm-sp': 'taxonomyMusicSoloPercussion',
	'm-si': 'taxonomyMusicSoloInstrument',
	'm-m': 'taxonomyMusicMultipleInstruments',
	'm-other': 'taxonomyMusicOther',
	'is-p': 'taxonomySamplesPercussion',
	'is-s': 'taxonomySamplesString',
	'is-w': 'taxonomySamplesWind',
	'is-k': 'taxonomySamplesKeyboard',
	'is-e': 'taxonomySamplesElectronic',
	'is-other': 'taxonomySamplesOther',
	'sp-s': 'taxonomySpeechSolo',
	'sp-c': 'taxonomySpeechCrowd',
	'sp-p': 'taxonomySpeechProcessed',
	'sp-other': 'taxonomySpeechOther',
	'fx-o': 'taxonomyEffectsObjects',
	'fx-v': 'taxonomyEffectsVehicles',
	'fx-m': 'taxonomyEffectsMachines',
	'fx-h': 'taxonomyEffectsHuman',
	'fx-a': 'taxonomyEffectsAnimals',
	'fx-n': 'taxonomyEffectsNatural',
	'fx-ex': 'taxonomyEffectsExperimental',
	'fx-el': 'taxonomyEffectsElectronic',
	'fx-other': 'taxonomyEffectsOther',
	'ss-n': 'taxonomySoundscapesNature',
	'ss-i': 'taxonomySoundscapesIndoors',
	'ss-u': 'taxonomySoundscapesUrban',
	'ss-s': 'taxonomySoundscapesSynthetic',
	'ss-other': 'taxonomySoundscapesOther',
} as const);

export default function FreesoundPublishDialog({
	copy,
	item,
	onClose,
	onPublish,
}: FreesoundPublishDialogProps) {
	const formId = useId();
	const descriptionId = useId();
	const tagsHelpId = useId();
	const [title, setTitle] = useState(item.title);
	const [description, setDescription] = useState(item.description);
	const [tags, setTags] = useState(item.tags.join(', '));
	const [categoryId, setCategoryId] = useState(item.categoryId ?? 'fx-other');
	const [license, setLicense] = useState<FreesoundPublishLicense>(item.license ?? 'cc-by');
	const [rightsConfirmed, setRightsConfirmed] = useState(item.rightsConfirmed === true);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		setTitle(item.title);
		setDescription(item.description);
		setTags(item.tags.join(', '));
		setCategoryId(item.categoryId ?? 'fx-other');
		setLicense(item.license ?? 'cc-by');
		setRightsConfirmed(item.rightsConfirmed === true);
		setPending(false);
		setError('');
	}, [item]);

	const submit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setPending(true);
		setError('');
		void Promise.resolve(onPublish(item.id, {
			title,
			description,
			tags: parseTags(tags),
			categoryId,
			license,
			rightsConfirmed,
		})).then(onClose).catch((reason: unknown) => {
			setPending(false);
			setError(reason instanceof Error && reason.message ? reason.message : copy.publishError);
		});
	};

	return <AudioEditorDialogShell
		title={copy.publishDialogTitle}
		onClose={pending ? undefined : onClose}
		width={620}
		initialFocus={'[name="title"]'}
		ariaDescribedBy={descriptionId}
		dataAttributes={{ 'data-freesound-publish-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={pending} onClick={onClose}>{copy.cancel}</Button>
			<Button variant="primary" type="submit" form={formId} disabled={pending || Boolean(item.blockedReason)}>
				{pending ? copy.publishing : copy.publish}
			</Button>
		</>} />}
	>
		<form id={formId} className="kw-audio-editor__freesound-publish-form" onSubmit={submit}>
			<p id={descriptionId}>{copy.publishDescription}</p>
			{item.blockedReason ? <p className="kw-audio-editor__freesound-inline-error" role="alert">
				{item.blockedReason}
			</p> : null}
			{error ? <p className="kw-audio-editor__freesound-inline-error" role="alert">{error}</p> : null}
			<label>
				<span>{copy.uploadTitle}</span>
				<input name="title" required maxLength={512} value={title}
					onChange={(event) => setTitle(event.currentTarget.value)} />
			</label>
			<label>
				<span>{copy.uploadDescription}</span>
				<textarea name="description" required maxLength={65_536} rows={8} value={description}
					onChange={(event) => setDescription(event.currentTarget.value)} />
			</label>
			<label>
				<span>{copy.uploadTags}</span>
				<input name="tags" required value={tags} placeholder={copy.uploadTagsPlaceholder}
					aria-label={copy.uploadTags} aria-describedby={tagsHelpId}
					onChange={(event) => setTags(event.currentTarget.value)} />
				<small id={tagsHelpId}>{copy.uploadTagsHelp}</small>
			</label>
			<label>
				<span>{copy.uploadCategory}</span>
				<select name="categoryId" required value={categoryId}
					onChange={(event) => setCategoryId(event.currentTarget.value)}>
					{FREESOUND_BROAD_SOUND_TAXONOMY.map((option) => <option key={option.id} value={option.id}>
						{taxonomyLabel(copy, option)}
					</option>)}
				</select>
			</label>
			<label>
				<span>{copy.uploadLicense}</span>
				<select name="license" required value={license}
					onChange={(event) => setLicense(event.currentTarget.value as FreesoundPublishLicense)}>
					{LICENSES.filter((value) => !item.allowedLicenses || item.allowedLicenses.includes(value))
						.map((value) => <option key={value} value={value}>{licenseLabel(copy, value)}</option>)}
				</select>
			</label>
			{item.attributionText ? <div className="kw-audio-editor__freesound-required-attribution">
				<strong>{copy.requiredAttribution}</strong>
				<pre>{item.attributionText}</pre>
			</div> : null}
			{item.requiresRightsConfirmation ? <label className="kw-audio-editor__freesound-rights-confirmation">
				<input type="checkbox" name="rightsConfirmed" checked={rightsConfirmed}
					onChange={(event) => setRightsConfirmed(event.currentTarget.checked)} />
				<span>{copy.confirmUploadRights}</span>
			</label> : null}
			<p className="kw-audio-editor__freesound-publish-note">{copy.publishModerationNote}</p>
		</form>
	</AudioEditorDialogShell>;
}

function parseTags(value: string): string[] {
	return value.split(/[,\s]+/u).map((tag) => tag.trim()).filter(Boolean);
}

function licenseLabel(copy: Readonly<Record<string, string>>, license: FreesoundPublishLicense): string {
	return {
		cc0: copy.licenseCc0,
		'cc-by': copy.licenseAttribution,
		'cc-by-nc': copy.licenseAttributionNoncommercial,
	}[license];
}

function taxonomyLabel(
	copy: Readonly<Record<string, string>>,
	option: (typeof FREESOUND_BROAD_SOUND_TAXONOMY)[number],
): string {
	const key = TAXONOMY_COPY_KEY_BY_ID[option.id as keyof typeof TAXONOMY_COPY_KEY_BY_ID];
	return copy[key] || `${option.category} — ${option.subcategory}`;
}
