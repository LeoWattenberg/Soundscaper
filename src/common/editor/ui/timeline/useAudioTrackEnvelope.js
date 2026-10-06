import { useEffect, useRef, useState } from 'react';

import { mergeDesignEnvelopePoints } from '../../automation.js';

export function useAudioTrackEnvelope({
	controller,
	run,
	blocked,
	automationToolEnabled,
	clipLookup,
	projectionClips,
	sampleRate,
}) {
	const envelopePreviewRef = useRef(new Map());
	const [envelopePreviewRevision, setEnvelopePreviewRevision] = useState(0);

	useEffect(() => {
		const discardEnvelopeEdit = (event) => {
			if (event.key !== 'Escape') return;
			queueMicrotask(() => {
				if (!envelopePreviewRef.current.size) return;
				envelopePreviewRef.current.clear();
				setEnvelopePreviewRevision((revision) => revision + 1);
			});
		};
		const finishEnvelopeEdit = () => queueMicrotask(() => {
			const previews = [...envelopePreviewRef.current.values()];
			if (!previews.length) return;
			envelopePreviewRef.current.clear();
			setEnvelopePreviewRevision((revision) => revision + 1);
			for (const preview of previews) {
				run(() => controller.actions.clip.update(preview.clipId, { envelope: preview.envelope }));
			}
		});
		document.addEventListener('mouseup', finishEnvelopeEdit);
		document.addEventListener('keydown', discardEnvelopeEdit);
		return () => {
			document.removeEventListener('mouseup', finishEnvelopeEdit);
			document.removeEventListener('keydown', discardEnvelopeEdit);
		};
	}, [controller, run]);

	useEffect(() => {
		if (automationToolEnabled) return;
		envelopePreviewRef.current.clear();
		setEnvelopePreviewRevision((revision) => revision + 1);
	}, [automationToolEnabled]);

	const updateEnvelope = (clipId, designPoints) => {
		if (blocked || !automationToolEnabled) return;
		const canonical = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const projected = projectionClips.find((clip) => String(clip.id) === String(clipId));
		if (!canonical || !projected) return;
		const startFrame = projected.waveformStartFrame;
		const endFrame = projected.waveformEndFrame;
		envelopePreviewRef.current.set(String(canonical.id), {
			clipId: canonical.id,
			designPoints,
			envelope: mergeDesignEnvelopePoints(
				canonical.envelope,
				designPoints,
				sampleRate,
				canonical.durationFrames,
				{ startFrame, endFrame, maximumValue: 2 },
			),
		});
		setEnvelopePreviewRevision((revision) => revision + 1);
	};
	return { envelopePreviewRef, envelopePreviewRevision, updateEnvelope };
}
