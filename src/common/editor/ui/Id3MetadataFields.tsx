/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { ID3_DESCRIPTIVE_FIELDS, id3ProjectFieldValue, isId3ProjectTag, updateId3ProjectField } from '../id3-descriptive-fields.ts';
import { createId3Artwork, parseId3Artwork, type Id3Artwork } from '../id3-artwork.ts';
import { id3MetadataCopy } from '../../i18n/editor-id3-metadata-copy.ts';
import { MetadataEditorField } from './workspace/LabelManagerRows.jsx';
import './id3-metadata-fields.css';

interface Id3MetadataFieldsProps {
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: string;
	readonly disabled: boolean;
	readonly onUpdate: (changes: Readonly<Record<string, unknown>>) => void;
}

export default function Id3MetadataFields({ metadata, copy, locale, disabled, onUpdate }: Id3MetadataFieldsProps) {
	const labels = id3MetadataCopy(locale, copy) as Readonly<Record<string, string>>;
	const tags = metadata.tags && typeof metadata.tags === 'object' ? metadata.tags as Readonly<Record<string, unknown>> : {};
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [customName, setCustomName] = useState('');
	const [customValue, setCustomValue] = useState('');
	const alive = useRef(true);
	const current = useRef({ metadata, disabled, onUpdate });
	current.current = { metadata, disabled, onUpdate };
	useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
	let artwork: readonly Id3Artwork[] = [];
	let artworkError = '';
	try { artwork = parseId3Artwork(id3ProjectFieldValue(metadata, 'id3Artwork')); } catch { artworkError = labels.artworkError; }
	const commitArtwork = (items: readonly Id3Artwork[]): void => {
		try {
			onUpdate(updateId3ProjectField(metadata, 'id3Artwork', items.length ? JSON.stringify(parseId3Artwork(items)) : ''));
			setError('');
		} catch { setError(labels.artworkError); }
	};
	const addArtwork = async (file: File): Promise<void> => {
		setBusy(true);
		setError('');
		try {
			const picture = await createId3Artwork(file);
			if (!alive.current || current.current.disabled) return;
			const latest = current.current;
			const items = parseId3Artwork([ ...parseId3Artwork(id3ProjectFieldValue(latest.metadata, 'id3Artwork')), picture ]);
			latest.onUpdate(updateId3ProjectField(latest.metadata, 'id3Artwork', JSON.stringify(items)));
		} catch { if (alive.current) setError(labels.artworkError); }
		finally { if (alive.current) setBusy(false); }
	};
	const addCustom = (): void => {
		const name = customName.trim();
		if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(name) || isId3ProjectTag(name) || Object.hasOwn(tags, name)) {
			setError(labels.customName);
			return;
		}
		onUpdate({ tags: { ...tags, [name]: customValue } });
		setCustomName('');
		setCustomValue('');
		setError('');
	};
	return (
		<div data-id3-metadata-fields className="kw-audio-editor__metadata-list">
			{[...new Set(ID3_DESCRIPTIVE_FIELDS.map(field => field.group))].map(group => (
				<fieldset key={group}>
					<legend>{labels[group]}</legend>
					{ID3_DESCRIPTIVE_FIELDS.filter(field => field.group === group).map(field => (
						<div key={field.key}>
							<MetadataEditorField name={`id3-${field.key}`} label={labels[field.key]}
								value={id3ProjectFieldValue(metadata, field.key)} disabled={disabled}
								multiline={field.kind === 'pairs' || ['lyrics', 'synchronizedLyrics', 'comments', 'termsOfUse'].includes(field.key)}
								onCommit={(value: string) => onUpdate(updateId3ProjectField(metadata, field.key, value))} />
							{field.kind === 'pairs' && <small>{labels.pairHint}</small>}
						</div>
					))}
				</fieldset>
			))}
			<fieldset>
				<legend>{labels.artwork}</legend>
				{artwork.map((picture, index) => (
					<div key={index} className="audio-editor-id3-artwork">
						<img src={`data:${picture.mimeType};base64,${picture.data}`} alt={picture.description} width="96" height="96" />
						<label><span>{labels.pictureType}</span><select value={picture.pictureType} disabled={disabled || busy}
							onChange={event => commitArtwork(artwork.map((item, position) => position === index ? { ...item, pictureType: Number(event.currentTarget.value) } : item))}>
							{Array.from({ length: 21 }, (_value, type) => labels[`picture${type}`]).map((name, type) => <option key={type} value={type}>{name}</option>)}
						</select></label>
						<MetadataEditorField name={`id3-picture-${index}`} label={labels.pictureDescription} value={picture.description}
							disabled={disabled || busy} onCommit={(description: string) => commitArtwork(artwork.map((item, position) => position === index ? { ...item, description } : item))} />
						<button type="button" disabled={disabled || busy} onClick={() => commitArtwork(artwork.filter((_item, position) => position !== index))}>{labels.remove}</button>
					</div>
				))}
				<label><span>{labels.addArtwork}</span><input type="file" accept="image/png,image/jpeg" disabled={disabled || busy}
					onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void addArtwork(file); }} /></label>
			</fieldset>
			<fieldset>
				<legend>{labels.custom}</legend>
				<p>{labels.customHint}</p>
				{Object.entries(tags).filter(([key]) => !isId3ProjectTag(key)).map(([key, value]) => (
					<MetadataEditorField key={key} name={`id3-custom-${key}`} label={key} value={String(value ?? '')} disabled={disabled}
						onCommit={(next: string) => onUpdate({ tags: { ...tags, [key]: next } })} />
				))}
				<label><span>{labels.customName}</span><input value={customName} disabled={disabled} onChange={event => setCustomName(event.currentTarget.value)} /></label>
				<label><span>{labels.customValue}</span><input value={customValue} disabled={disabled} onChange={event => setCustomValue(event.currentTarget.value)} /></label>
				<button type="button" disabled={disabled || !customName.trim()} onClick={addCustom}>{labels.addField}</button>
			</fieldset>
			{(error || artworkError) && <p role="alert">{error || artworkError}</p>}
		</div>
	);
}
