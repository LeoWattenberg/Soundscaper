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
	const currentClipLookupRef = useRef(clipLookup);
	currentClipLookupRef.current = clipLookup;

	useEffect(() => {
		const previousSize = envelopePreviewRef.current.size;
		for (const [key, preview] of envelopePreviewRef.current) {
			if (!clipLookup.has(preview.clipId)) envelopePreviewRef.current.delete(key);
		}
		if (previousSize !== envelopePreviewRef.current.size) setEnvelopePreviewRevision(revision => revision + 1);
	}, [clipLookup]);

	useEffect(() => {
		const pendingTasks = new Set();
		// Native events can run microtasks between document listeners. Wait for
		// the vendor's point publication before completing this gesture.
		const afterEvent = (operation) => {
			const task = setTimeout(() => { pendingTasks.delete(task); operation(); }, 0);
			pendingTasks.add(task);
		};
		const discardEnvelopeEdit = (event) => {
			if (event.key !== 'Escape') return;
			afterEvent(() => {
				if (!envelopePreviewRef.current.size) return;
				envelopePreviewRef.current.clear();
				setEnvelopePreviewRevision((revision) => revision + 1);
			});
		};
		const finishEnvelopeEdit = () => afterEvent(() => {
			const previews = [...envelopePreviewRef.current.values()];
			if (!previews.length) return;
			envelopePreviewRef.current.clear();
			setEnvelopePreviewRevision((revision) => revision + 1);
			for (const preview of previews) {
				if (!currentClipLookupRef.current.has(preview.clipId)) continue;
				run(() => controller.actions.clip.update(preview.clipId, { envelope: preview.envelope }));
			}
		});
		document.addEventListener('mouseup', finishEnvelopeEdit);
		document.addEventListener('keydown', discardEnvelopeEdit);
		return () => {
			for (const task of pendingTasks) clearTimeout(task);
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
