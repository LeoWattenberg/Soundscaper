/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageMetadataIssueV1 } from '../../imaging/image-metadata-model-v1.ts';
import type { PhotoLibraryMetadataSnapshotV1 } from '../../photo-library-session-port-v1.ts';
import type { LightscaperEditorUiCopyV1 } from './use-lightscaper-editor-copy.ts';

type FactValue = string | number | null | undefined | readonly string[];
type Fact = readonly [label: string, value: FactValue];
interface Props {
	readonly snapshot: PhotoLibraryMetadataSnapshotV1;
	readonly copy: LightscaperEditorUiCopyV1;
	readonly locale: string;
	readonly source?: boolean;
}

/** Facts remain borrowed read-only values. No effective field is inferred from source alternatives. */
export default function PhotoMetadataReadFacts({ snapshot, copy, locale, source = false }: Props) {
	const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumSignificantDigits: 21 });
	const facts = (values: readonly Fact[]) => <dl>{values.map(([label, value]) => <div key={label}>
		<dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === null || value === undefined
			? copy.photoMetadataUnknown : typeof value === 'number' ? number.format(value) : typeof value === 'string' ? value
				: <ul>{value.map((text, index) => <li key={index}>{text}</li>)}</ul>}</dd>
	</div>)}</dl>;
	const { metadata, extracted } = snapshot;
	if (!source) return <section aria-label={copy.photoEffectiveMetadata} data-photo-effective-metadata>
		<h3>{copy.photoEffectiveMetadata}</h3>{facts([
			[copy.photoCameraMake, metadata.cameraMake], [copy.photoCameraModel, metadata.cameraModel], [copy.photoLens, metadata.lens],
			[copy.photoOrientation, metadata.orientation], [copy.photoExposureSeconds, metadata.exposureSeconds], [copy.photoAperture, metadata.aperture],
			[copy.photoIso, metadata.iso], [copy.photoFocalLengthMm, metadata.focalLengthMm], [copy.photoModifiedTime, metadata.modifiedTime],
		])}
	</section>;
	const exif = extracted?.exif, iptc = extracted?.iptc;
	const issueLabels: Readonly<Record<ImageMetadataIssueV1, string>> = {
		'malformed-container': copy.photoMetadataMalformedContainer, 'malformed-exif': copy.photoMetadataMalformedExif,
		'malformed-iptc': copy.photoMetadataMalformedIptc, 'metadata-limit': copy.photoMetadataLimit,
		'duplicate-metadata': copy.photoMetadataDuplicate, 'unsupported-text-encoding': copy.photoMetadataUnsupportedEncoding,
	};
	return <>
		{facts([[copy.photoFileName, snapshot.originalFileName], ...(extracted ? [[copy.photoMetadataSourceFormat, extracted.container] as const] : [])])}
		{exif && <section aria-label={copy.photoExifMetadata} data-photo-exif-metadata><h3>{copy.photoExifMetadata}</h3>{facts([
			[copy.photoCameraMake, exif.cameraMake], [copy.photoCameraModel, exif.cameraModel], [copy.photoLens, exif.lensModel],
			[copy.photoOrientation, exif.orientation], [copy.photoExposureSeconds, exif.exposureSeconds], [copy.photoAperture, exif.aperture],
			[copy.photoIso, exif.iso], [copy.photoFocalLengthMm, exif.focalLengthMm], [copy.photoCreator, exif.artist],
			[copy.photoCopyright, exif.copyright], [copy.photoCaption, exif.description],
			[copy.photoCaptureTime, exif.captureTime?.local], [copy.photoCaptureOffsetMinutes, exif.captureTime?.offsetMinutes],
			[copy.photoCaptureSubsecond, exif.captureTime?.subsecond],
			[copy.photoRecordedCaptureDateTime, exif.captureTimeRaw?.dateTimeOriginal],
			[copy.photoRecordedCaptureOffset, exif.captureTimeRaw?.offsetTimeOriginal],
			[copy.photoRecordedCaptureSubsecond, exif.captureTimeRaw?.subsecondOriginal],
		])}</section>}
		{iptc && <section aria-label={copy.photoIptcMetadata} data-photo-iptc-metadata><h3>{copy.photoIptcMetadata}</h3>{facts([
			[copy.photoIptcObjectName, iptc.objectName], [copy.photoIptcHeadline, iptc.headline], [copy.photoCaption, iptc.caption],
			[copy.photoCopyright, iptc.copyright], [copy.photoCreator, iptc.creators], [copy.photoKeywords, iptc.keywords],
			[copy.photoIptcCity, iptc.city], [copy.photoIptcSublocation, iptc.sublocation], [copy.photoIptcState, iptc.state],
			[copy.photoIptcCountry, iptc.country], [copy.photoRecordedCaptureDate, iptc.captureDate],
			[copy.photoRecordedCaptureTime, iptc.captureTime], [copy.photoMetadataEncoding, iptc.encoding],
		])}</section>}
		{!exif && !iptc && <p>{copy.photoNoSourceMetadata}</p>}
		{Boolean(extracted?.issues.length) && <section aria-label={copy.photoMetadataIssues}>
			<p>{copy.photoMetadataNotice}</p><ul>{extracted!.issues.map((issue, index) => <li key={index}>{issueLabels[issue]}</li>)}</ul>
		</section>}
	</>;
}
