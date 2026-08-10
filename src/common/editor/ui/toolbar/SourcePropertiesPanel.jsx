/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

import { resolveVideoSourcePropertiesView } from '../../source-properties-model.ts';

const NOTE_COPY_KEYS = Object.freeze({
	'interlaced-presented-as-coded': 'noteInterlaced',
	'rotation-not-applied': 'noteRotationNotApplied',
	'geometry-disagrees': 'noteGeometryDisagrees',
	'additional-audio-programs': 'noteAdditionalAudioPrograms',
	'conformed-at-ingest': 'noteConformedAtIngest',
	'timing-unprobed': 'noteTimingUnprobed',
});

/**
 * What a probe reported about the source under the playhead. An unreported
 * characteristic reads as unknown rather than as a plausible value, and every
 * characteristic the product records without acting on it is disclosed here.
 */
export function SourcePropertiesPanel({ source, copy }) {
	const view = React.useMemo(
		() => (source ? resolveVideoSourcePropertiesView(source) : null),
		[source],
	);
	if (!view) {
		return <div className="kw-audio-editor__source-properties" data-source-properties="empty">
			<p>{copy.sourceNoClip}</p>
		</div>;
	}
	const { characteristics: reported, geometry } = view;
	const rows = [
		[copy.sourceVideoCodec, view.videoCodec],
		[copy.sourceAudioCodec, view.audioCodec],
		[copy.sourcePresentedSize, `${String(view.presentedWidth)} × ${String(view.presentedHeight)}`],
		[copy.sourceDisplaySize, `${String(geometry.displayWidth)} × ${String(geometry.displayHeight)}`],
		[copy.sourceCodedSize, reported.codedWidth != null && reported.codedHeight != null
			? `${String(reported.codedWidth)} × ${String(reported.codedHeight)}`
			: null],
		[copy.sourceRotation, reported.rotationDegrees == null ? null : `${String(reported.rotationDegrees)}°`],
		[copy.sourcePixelAspect, reported.pixelAspectRatio
			? `${String(reported.pixelAspectRatio.num)}:${String(reported.pixelAspectRatio.den)}`
			: null],
		[copy.sourceFieldOrder, reported.fieldOrder],
		[copy.sourceAlpha, reported.hasAlpha == null ? null : String(reported.hasAlpha)],
		[copy.sourceColour, colourLabel(reported.colour)],
		[copy.sourceStartTimecode, view.startTimecodeLabel],
		[copy.sourceTiming, view.timingBackend ? `${view.timingMode} (${view.timingBackend})` : view.timingMode],
	];

	return <div className="kw-audio-editor__source-properties" data-source-properties={view.sourceId}>
		<header>
			<strong>{copy.sourceProperties}</strong>
			<span>{view.name}</span>
		</header>
		<dl>
			{rows.map(([label, value]) => <div key={label} data-source-property={label}>
				<dt>{label}</dt>
				<dd data-reported={value == null ? 'false' : 'true'}>{value ?? copy.sourceUnknown}</dd>
			</div>)}
		</dl>
		<section data-source-audio-streams={String(reported.audioStreams?.length ?? 0)}>
			<h4>{copy.sourceAudioStreams}</h4>
			{reported.audioStreams
				? <ul>
					{reported.audioStreams.map((stream) => <li key={stream.index}>
						{streamLabel(stream, copy)}
						{stream.index === reported.extractedAudioStreamIndex
							? <em> — {copy.sourceExtractedStream}</em>
							: null}
					</li>)}
				</ul>
				: <p>{copy.sourceUnknown}</p>}
		</section>
		{view.notes.length > 0 && <ul className="kw-audio-editor__source-properties-notes" data-source-notes>
			{view.notes.map((note) => <li key={note} data-source-note={note}>{copy[NOTE_COPY_KEYS[note]]}</li>)}
		</ul>}
		<p
			className="kw-audio-editor__visually-hidden"
			data-source-reconciliation={geometry.reconciliation}
		>{geometry.reconciliation}</p>
	</div>;
}

function streamLabel(stream, copy) {
	const parts = [
		`#${String(stream.index)}`,
		stream.codec ?? copy.sourceUnknown,
		stream.channelCount == null ? null : `${String(stream.channelCount)}ch`,
		stream.sampleRate == null ? null : `${String(stream.sampleRate)} Hz`,
		stream.language,
	];
	return parts.filter(Boolean).join(' · ');
}

function colourLabel(colour) {
	const parts = [colour.primaries, colour.transfer, colour.matrix, colour.range].filter(Boolean);
	return parts.length ? parts.join(' / ') : null;
}
