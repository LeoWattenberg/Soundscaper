/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';

/** Keep the sidecar's destination fields on the chosen saved caption track. */
export function useCaptionTrackFields(project: unknown) {
	const value = object(project);
	const tracks = Array.isArray(value.videoCaptionTracks)
		? value.videoCaptionTracks.map(object) : [];
	const first = tracks[0];
	const [captionTrackId, setCaptionTrackId] = useState(() => text(first?.id, 'captions-1'));
	const [captionSequenceId, setCaptionSequenceId] = useState(() => text(first?.sequenceId,
		text(value.primarySequenceId, Array.isArray(value.sequences) ? text(object(value.sequences[0]).id, '') : '')));
	const [captionTrackName, setCaptionTrackName] = useState(() => text(first?.name, 'Captions'));
	const [captionLanguage, setCaptionLanguage] = useState(() => text(first?.language, 'und'));
	const selected = tracks.find(({ id }) => id === captionTrackId);
	const sequenceId = selected?.sequenceId;
	const name = selected?.name;
	const language = selected?.language;
	useEffect(() => {
		if (typeof sequenceId === 'string') setCaptionSequenceId(sequenceId);
		if (typeof name === 'string') setCaptionTrackName(name);
		if (typeof language === 'string') setCaptionLanguage(language);
	}, [captionTrackId, sequenceId, name, language]);
	return { captionTrackId, setCaptionTrackId, captionSequenceId, setCaptionSequenceId,
		captionTrackName, setCaptionTrackName, captionLanguage, setCaptionLanguage };
}

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}
