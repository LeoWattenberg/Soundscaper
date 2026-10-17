/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { imageHdrMergeCopy } from '../../../i18n/image-hdr-merge-copy.ts';
import { ImageHdrMergeAuthoringCurrentV1, type ImageHdrMergeAuthoringSnapshotCurrentV1 } from '../../controller/shared/image-hdr-merge-authoring-current-v1.ts';
import type { ImageHdrMergeAuthoringOptionsCurrentV1, ImageHdrMergeAuthoringPortCurrentV1 } from '../../image-hdr-merge-authoring-port-current-v1.ts';
import { clearPixelFrameCanvasV1, paintPixelFrameCanvasV1 } from '../../imaging/pixel-frame-canvas-presenter-v1.ts';

export interface ImageHdrMergeDialogPropsCurrentV1<Acknowledgement = unknown> {
	readonly port: Readonly<ImageHdrMergeAuthoringPortCurrentV1<Acknowledgement>>;
	readonly locale: string;
	readonly isCurrent: () => boolean;
	readonly beforeOpen?: Promise<void>;
	readonly onAcknowledged?: (value: Readonly<Acknowledgement>) => void;
	readonly publicationNotices?: readonly string[];
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
const DISPLAY_LIMITS = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 2048 * 2048, maximumBytes: 2048 * 2048 * 4 });
type DraftKey = 'fileName' | 'threshold' | `exposure:${number}`;
interface TextDrafts {
	readonly owner: object;
	readonly fields: Readonly<Partial<Record<DraftKey, Readonly<{ value: string; invalid: boolean; revision: number }>>>>;
}

/** Scalar presentation only. Preview is painted in the scoped callback; no
 * borrowed native or display pixels enter React state. */
export default function ImageHdrMergeDialogCurrentV1<Acknowledgement>(props: ImageHdrMergeDialogPropsCurrentV1<Acknowledgement>) {
	const copy = imageHdrMergeCopy(props.locale), latest = useRef(props); latest.current = props;
	const live = useRef(false), predecessor = useRef<Promise<void>>(Promise.resolve());
	const [lifecycle, setLifecycle] = useState(0), [rejected, setRejected] = useState(false);
	const [storedDrafts, setStoredDrafts] = useState<TextDrafts | null>(null), editRevision = useRef(0);
	const active = useRef<ImageHdrMergeAuthoringCurrentV1<Acknowledgement> | null>(null);
	const generation = useMemo(() => {
		const port = props.port;
		const owner = new ImageHdrMergeAuthoringCurrentV1<Acknowledgement>({ port,
			isCurrent: () => live.current && active.current === owner && latest.current.port === port && latest.current.isCurrent() });
		return { owner, key: `${lifecycle}:${crypto.randomUUID()}` };
	}, [props.port, lifecycle]);
	const { owner } = generation; active.current = owner;
	const canvas = useMemo(() => ({ owner, current: null as HTMLCanvasElement | null }), [owner]);
	const retainedCanvas = useMemo(() => ({ owner, current: null as HTMLCanvasElement | null }), [owner]);
	const attachCanvas = useCallback((node: HTMLCanvasElement | null) => { canvas.current = node; if (node) retainedCanvas.current = node; }, [canvas, retainedCanvas]);
	const [stored, setStored] = useState<{ owner: typeof owner; view: Readonly<ImageHdrMergeAuthoringSnapshotCurrentV1<Acknowledgement>> }>(() => ({ owner, view: owner.snapshot() }));
	const view = stored.owner === owner ? stored.view : owner.snapshot(), rendered = useRef(view); rendered.current = view;
	const drafts: TextDrafts['fields'] = storedDrafts?.owner === owner ? storedDrafts.fields : {};
	const invalid = rejected || Object.values(drafts).some(draft => draft?.invalid);
	const acknowledged = useRef<Readonly<Acknowledgement> | null>(null);
	const same = () => live.current && active.current === owner;
	const current = () => same() && latest.current.port === props.port && latest.current.isCurrent() && !owner.snapshot().closed;
	const clear = useCallback(() => { if (retainedCanvas.current) clearPixelFrameCanvasV1(retainedCanvas.current); }, [retainedCanvas]);
	useLayoutEffect(() => {
		live.current = true;
		setRejected(false);
		if (owner.snapshot().closed) { setLifecycle(value => value + 1); return; }
		let mounted = true;
		const unsubscribe = owner.subscribe(next => {
			if (!mounted) return;
			setStored({ owner, view: next });
			if (next.acknowledged !== null && !Object.is(acknowledged.current, next.acknowledged)) {
				acknowledged.current = next.acknowledged; latest.current.onAcknowledged?.(next.acknowledged);
			}
			if (!next.working && !next.previewReady) clear();
		});
		const retire = () => owner.close().then(clear, (error: unknown) => { clear(); throw error; });
		const unregister = latest.current.registerRetirement?.(retire);
		const before = Promise.all([predecessor.current, latest.current.beforeOpen ?? Promise.resolve()]).then(() => undefined);
		void owner.open(before).catch(() => undefined);
		return () => {
			mounted = false; live.current = false; unsubscribe(); predecessor.current = retire();
			void predecessor.current.catch(() => undefined); unregister?.();
		};
	}, [owner, clear]);
	const edit = (change: Partial<ImageHdrMergeAuthoringOptionsCurrentV1>) => {
		if (!current() || view.working || !view.options || view.acknowledged !== null) return;
		void owner.setOptions({ ...view.options, ...change }).then(() => { if (same()) setRejected(false); }, () => { if (same()) setRejected(true); });
	};
	const editText = (key: DraftKey, value: string, change: Partial<ImageHdrMergeAuthoringOptionsCurrentV1> | null) => {
		if (!current() || view.working || !view.options || view.acknowledged !== null) return;
		const revision = ++editRevision.current;
		setStoredDrafts(previous => ({ owner, fields: { ...(previous?.owner === owner ? previous.fields : {}), [key]: { value, invalid: true, revision } } }));
		clear();
		if (!change) return;
		const finish = (invalid: boolean) => {
			if (!same()) return;
			setStoredDrafts(previous => {
				if (previous?.owner !== owner || previous.fields[key]?.revision !== revision) return previous;
				return { owner, fields: { ...previous.fields, [key]: { value, invalid, revision } } };
			});
			if (!invalid) setRejected(false);
		};
		void owner.setOptions({ ...view.options, ...change }).then(() => { finish(false); }, () => { finish(true); });
	};
	const preview = () => {
		if (!current() || rendered.current !== view || view.working || invalid || !view.options || view.acknowledged !== null) return;
		clear();
		void owner.preview(value => {
			if (!current() || !canvas.current) throw new Error('HDR Preview target changed.');
			paintPixelFrameCanvasV1(canvas.current, value.frame, { limits: DISPLAY_LIMITS });
		}).catch(() => { if (same()) clear(); });
	};
	const merge = () => {
		if (!current() || rendered.current !== view || view.working || invalid || !view.options || view.acknowledged !== null) return;
		void owner.merge().catch(() => undefined);
	};
	const close = () => {
		if (!same()) return;
		const dismiss = () => { clear(); if (same()) latest.current.onClose(); };
		void owner.close().then(dismiss, dismiss);
	};
	const locked = view.working || view.closed || view.acknowledged !== null, options = view.options;
	return <AudioEditorDialogShell title={copy.title} onClose={close} className="lightscaper-dialog" overlayClassName="kw-audio-editor-dialog-backdrop audio-editor-controlled-dialog__backdrop lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-image-hdr-merge-dialog>
			{view.selection && options && <>
				<p>{view.selection.suggestedExposureMultipliers ? copy.metadataExposure : copy.manualExposure}</p>
				<label>{copy.reference}<select data-image-hdr-reference aria-label={copy.reference} value={options.referenceIndex} disabled={locked || invalid} onChange={event => {
					if (!current() || locked || invalid) return;
					void owner.setReference(Number(event.currentTarget.value)).then(() => {
						if (!same()) return;
						setRejected(false); setStoredDrafts(previous => {
							if (previous?.owner !== owner) return previous;
							const fields = { ...previous.fields };
							for (let index = 0; index < options.exposureMultipliers.length; index++) delete fields[`exposure:${index}`];
							return { owner, fields };
						});
					}, () => { if (same()) setRejected(true); });
				}}>{view.selection.sources.map((source, index) => <option key={source.key} value={index}>{source.label}</option>)}</select></label>
				{view.selection.sources.map((source, index) => <label key={source.key}>{source.label} — {copy.exposure}
					<input data-image-hdr-exposure-index={index} aria-label={`${source.label} — ${copy.exposure}`} type="number" min={-16} max={16} step="any"
						value={drafts[`exposure:${index}`]?.value ?? Math.log2(options.exposureMultipliers[index]!)} disabled={locked || index === options.referenceIndex} onChange={event => {
							const value = event.currentTarget.value, ev = Number(value);
							editText(`exposure:${index}`, value, !value.trim() || !Number.isFinite(ev) || ev < -16 || ev > 16 ? null
								: { exposureMultipliers: options.exposureMultipliers.map((n, at) => at === index ? 2 ** ev : n) });
						}} /></label>)}
				<label>{copy.alignment}<select aria-label={copy.alignment} value={options.alignment} disabled={locked} onChange={event => {
					const alignment = event.currentTarget.value; if (alignment === 'none' || alignment === 'ward-mtb-v1') edit({ alignment });
				}}><option value="none">{copy.noAlignment}</option><option value="ward-mtb-v1">{copy.ward}</option></select></label>
				<label>{copy.deghost}<select aria-label={copy.deghost} value={options.deghost.mode} disabled={locked} onChange={event => {
					const mode = event.currentTarget.value; if (mode === 'off' || mode === 'reference-v1') edit({ deghost: { ...options.deghost, mode } });
				}}><option value="off">{copy.deghostOff}</option><option value="reference-v1">{copy.deghostReference}</option></select></label>
				<label>{copy.threshold}<input aria-label={copy.threshold} type="number" min={0} max={1} step="any" value={drafts.threshold?.value ?? options.deghost.threshold} disabled={locked || options.deghost.mode === 'off'}
					onChange={event => { const value = event.currentTarget.value; editText('threshold', value, !value.trim() ? null : { deghost: { ...options.deghost, threshold: Number(value) } }); }} /></label>
				<label>{copy.fileName}<input data-image-hdr-file-name aria-label={copy.fileName} value={drafts.fileName?.value ?? options.fileName} disabled={locked} onChange={event => {
					const value = event.currentTarget.value; editText('fileName', value, { fileName: value });
				}} /></label>
			</>}
			<div data-image-hdr-preview data-state={view.working ? 'working' : invalid ? 'idle' : view.previewReady ? 'ready' : view.failed ? 'failed' : 'idle'}>
				<canvas key={generation.key} ref={attachCanvas} role="img" aria-label={copy.preview} /><p>{copy.previewCaption}</p>
			</div>
			{view.working && <p role="status">{copy.working}</p>}{view.failed && <p role="alert">{view.acknowledged !== null ? copy.followupFailed : copy.failed}</p>}{invalid && <p role="alert">{copy.invalid}</p>}
			{view.acknowledged !== null && <p role="status">{copy.created}</p>}
			{view.acknowledged !== null && props.publicationNotices?.map((notice, index) => <p role="status" key={index}>{notice}</p>)}
			{view.diagnostics && <p aria-label={copy.diagnostics}>{copy.motionPixels}: {view.diagnostics.motionPixels}; {copy.unresolvedPixels}: {view.diagnostics.unresolvedPixels}</p>}
			<div className="lightscaper-develop-actions"><button type="button" onClick={preview} disabled={locked || !options || invalid}>{copy.preview}</button>
				<button type="button" onClick={merge} disabled={locked || !options || invalid}>{copy.merge}</button><button type="button" onClick={close}>{copy.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
