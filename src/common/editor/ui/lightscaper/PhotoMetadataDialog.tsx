/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1 } from '../../photo-library-session-port-v1.ts';
import { useLightscaperEditorCopy as useSiteCopy } from './use-lightscaper-editor-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface Props {
	readonly locale: string;
	readonly snapshot: PhotoLibraryMetadataSnapshotV1 | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onClose: () => void;
	readonly onSave: (photoId: string, revision: number, changes: PhotoLibraryMetadataPatchV1) => void;
}

export default function PhotoMetadataDialog(props: Props) {
	const copy = useSiteCopy(props.locale);
	const snapshot = props.snapshot;
	return <AudioEditorDialogShell title={copy.photoEditMetadata} onClose={props.onClose}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop"
		initialFocus="input[name=fileName]" closeOnOutside={false}>
		{props.error && <p role="alert">{props.error}</p>}
		{!snapshot && props.busy && <p role="status">{copy.photoWorking}</p>}
		{snapshot && <form key={`${snapshot.photoId}:${String(snapshot.revision)}`} onSubmit={event => {
			event.preventDefault();
			if (props.busy) return;
			const fields = new FormData(event.currentTarget);
			const text = (key: string) => String(fields.get(key) ?? '');
			const local = text('captureLocal'), offset = text('captureOffset');
			const captureLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(local) ? `${local}:00` : local;
			props.onSave(snapshot.photoId, snapshot.revision, { fileName: text('fileName'), title: text('title'), caption: text('caption'),
				creator: text('creator'), copyright: text('copyright'), location: text('location'),
				captureTime: captureLocal ? { local: captureLocal, offsetMinutes: offset === '' ? null : Number(offset) } : null });
		}}>
			<fieldset disabled={props.busy}>
				{([['fileName', copy.photoFileName], ['title', copy.photoMetadataTitle], ['creator', copy.photoCreator], ['location', copy.photoLocation]] as const)
					.map(([key, label]) => <label key={key}>{label}<input name={key} autoFocus={key === 'fileName'} required={key === 'fileName'}
						maxLength={key === 'fileName' ? 256 : 16_384} defaultValue={snapshot.metadata[key]} /></label>)}
				{([['caption', copy.photoCaption], ['copyright', copy.photoCopyright]] as const).map(([key, label]) =>
					<label key={key}>{label}<textarea name={key} maxLength={16_384} defaultValue={snapshot.metadata[key]} /></label>)}
				<label>{copy.photoCaptureTime}<input name="captureLocal" type="datetime-local" step="0.001"
					defaultValue={snapshot.metadata.captureTime?.local ?? ''} /></label>
				<label>{copy.photoCaptureOffset}<input name="captureOffset" type="number" min={-840} max={840} step={1}
					defaultValue={snapshot.metadata.captureTime?.offsetMinutes ?? ''} /></label>
			</fieldset>
			<details>
				<summary>{copy.photoOriginalMetadata}</summary>
				<dl>
					<dt>{copy.photoFileName}</dt><dd>{snapshot.originalFileName}</dd>
					{snapshot.extracted?.exif && <>
						<dt>{copy.photoCamera}</dt><dd>{[snapshot.extracted.exif.cameraMake, snapshot.extracted.exif.cameraModel].filter(Boolean).join(' ')}</dd>
						<dt>{copy.photoLens}</dt><dd>{snapshot.extracted.exif.lensModel}</dd>
						<dt>{copy.photoCaptureTime}</dt><dd>{snapshot.extracted.exif.captureTime?.local}</dd>
					</>}
					{snapshot.extracted?.iptc && <>
						<dt>{copy.photoMetadataTitle}</dt><dd>{snapshot.extracted.iptc.objectName ?? snapshot.extracted.iptc.headline}</dd>
						<dt>{copy.photoCaption}</dt><dd>{snapshot.extracted.iptc.caption}</dd>
						<dt>{copy.photoCreator}</dt><dd>{snapshot.extracted.iptc.creators.join('; ')}</dd>
						<dt>{copy.photoKeywords}</dt><dd>{snapshot.extracted.iptc.keywords.join('; ')}</dd>
					</>}
				</dl>
				{!snapshot.extracted?.exif && !snapshot.extracted?.iptc && <p>{copy.photoNoSourceMetadata}</p>}
				{Boolean(snapshot.extracted?.issues.length) && <p>{copy.photoMetadataNotice}</p>}
			</details>
			<div className="lightscaper-dialog-actions"><button type="submit" disabled={props.busy}>{copy.photoSaveMetadata}</button>
				<button type="button" onClick={props.onClose}>{copy.photoCloseMetadata}</button></div>
		</form>}
		{!snapshot && !props.busy && <button type="button" onClick={props.onClose}>{copy.photoCloseMetadata}</button>}
	</AudioEditorDialogShell>;
}
