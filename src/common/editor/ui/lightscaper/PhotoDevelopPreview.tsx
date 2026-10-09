/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopPresentationV1, type PhotoDevelopPresentationSnapshotV1 } from '../../controller/shared/photo-library-develop-presentation-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PixelPreviewPresentationReaderV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV1 } from '../../photo-library-develop-proxy-port-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from '../../photo-library-develop-port-v1.ts';
import type { PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';
import type { PhotoDevelopCopyV1 } from '../../../i18n/lightscaper-develop-copy.ts';

export interface PhotoDevelopPreviewPropsV1 {
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV1;
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly resolution?: PhotoDevelopResolutionV1;
	readonly revision?: number;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV1;
	readonly beforePresent: Promise<void>;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
	readonly messages: PhotoDevelopCopyV1;
	readonly locale: string;
}
const MODES = ['compare', 'before', 'after', 'split'] as const;
type PreviewMode = typeof MODES[number];
export default function PhotoDevelopPreview(props: PhotoDevelopPreviewPropsV1) {
	const { readPreview, withOriginalFrame, loadProxy, beforePresent, registerRetirement } = props;
	const owner = useMemo(() => new PhotoLibraryDevelopPresentationV1({ readPreview, withOriginalFrame, loadProxy, beforePresent }), [readPreview, withOriginalFrame, loadProxy, beforePresent]);
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const before = useRef<HTMLCanvasElement>(null), after = useRef<HTMLCanvasElement>(null);
	const [view, setView] = useState(() => ({ owner, photoId: props.photoId, mode: 'compare' as PreviewMode, divider: 50 }));
	const selected = view.owner === owner && view.photoId === props.photoId ? view : { owner, photoId: props.photoId, mode: 'compare' as PreviewMode, divider: 50 };
	const rendered = useRef(selected); rendered.current = selected;
	const [snapshot, setSnapshot] = useState<PhotoDevelopPresentationSnapshotV1>(() => owner.snapshot());
	useLayoutEffect(() => {
		const unsubscribe = owner.subscribe(setSnapshot), unregister = registerRetirement(() => joinPhotoLibraryRetirementV1([retirement.current, owner.pause()]));
		return () => { unsubscribe(); unregister(); retirement.current = joinPhotoLibraryRetirementV1([retirement.current, owner.pause()]);
			void retirement.current.catch(() => undefined); };
	}, [owner, registerRetirement]);
	useLayoutEffect(() => {
		let current = true;
		void joinPhotoLibraryRetirementV1([retirement.current, owner.pause()]).then(() => {
			if (current && before.current && after.current) owner.setView({ photoId: props.photoId, develop: props.develop, revision: props.revision,
				resolution: props.resolution, before: before.current, after: after.current });
		}).catch(() => { if (current) setSnapshot(Object.freeze({ status: 'failed', before: null, after: null, extent: null, error: 'The develop preview failed.' })); });
		return () => { current = false; void owner.pause().catch(() => undefined); };
	}, [owner, props.photoId, props.develop, props.revision, props.resolution]);
	const { messages } = props, { mode, divider } = selected;
	const current = () => rendered.current === selected;
	const aspect = mode === 'split' && snapshot.extent ? `${snapshot.extent.after.width} / ${snapshot.extent.after.height}` : undefined;
	return <section aria-label={props.resolution === 'full' ? messages.fullPreview : messages.preview} data-photo-develop-preview data-state={snapshot.status}>
		<label>{messages.previewMode}<select value={mode} onChange={event => {
			const next = event.currentTarget.value;
			if (current() && MODES.some(value => value === next)) setView({ ...selected, mode: next as PreviewMode });
		}}>
			{MODES.map(value => <option key={value} value={value}>{messages[value]}</option>)}
		</select></label>
		{snapshot.status === 'pending' && <p role="status">{messages.working}</p>}
		{snapshot.status === 'missing' && <p role="status">{messages.missing}</p>}
		{snapshot.status === 'failed' && <p role="alert">{props.resolution === 'full' ? messages.fullResolutionFailed : messages.previewFailed}</p>}
		<div className="lightscaper-develop-scroll" tabIndex={props.resolution === 'full' ? 0 : undefined}
			role={props.resolution === 'full' ? 'region' : undefined} aria-label={props.resolution === 'full' ? messages.imageViewport : undefined}>
		<div className="lightscaper-develop-images" data-mode={mode} data-resolution={props.resolution ?? 'proxy'}
			style={{ aspectRatio: aspect, width: props.resolution === 'full' && mode === 'split' ? snapshot.extent?.after.width : undefined }}>
			<figure hidden={mode === 'after'} style={{ clipPath: mode === 'split' ? `inset(0 ${100 - divider}% 0 0)` : undefined }}>
				<figcaption>{messages.before}</figcaption><canvas ref={before} width={0} height={0} role="img" aria-label={messages.before} data-photo-develop-before /></figure>
			<figure hidden={mode === 'before'} style={{ clipPath: mode === 'split' ? `inset(0 0 0 ${divider}%)` : undefined }}>
				<figcaption>{messages.after}</figcaption><canvas ref={after} width={0} height={0} role="img" aria-label={messages.after} data-photo-develop-after /></figure>
			{mode === 'split' && <div className="lightscaper-develop-divider" aria-hidden="true" style={{ left: `${divider}%` }} />}
		</div></div>
		{mode === 'split' && <label>{messages.divider}<input type="range" min={0} max={100} step={1} value={divider} aria-label={messages.divider}
			onChange={event => { const raw = event.currentTarget.value, value = Number(raw);
				if (current() && raw !== '' && Number.isInteger(value) && value >= 0 && value <= 100) setView({ ...selected, divider: value });
			}} /></label>}
		<div className="lightscaper-develop-histograms">
			<div hidden={mode === 'after'}>{snapshot.before && <Histogram value={snapshot.before} label={messages.before} messages={messages} locale={props.locale} />}</div>
			<div hidden={mode === 'before'}>{snapshot.after && <Histogram value={snapshot.after} label={messages.after} messages={messages} locale={props.locale} />}</div>
		</div>
	</section>;
}
function Histogram({ value, label, messages, locale }: Readonly<{ value: PixelFrameHistogramV1; label: string; messages: PhotoDevelopCopyV1; locale: string }>) {
	const maximum = Math.max(1, ...value.bins.red, ...value.bins.green, ...value.bins.blue), number = new Intl.NumberFormat(locale);
	return <div className="lightscaper-develop-histogram"><svg viewBox="0 0 255 100" role="img" aria-label={`${messages.histogram}: ${label}`}>
		{(['red', 'green', 'blue'] as const).map(channel => <polyline key={channel} fill="none" stroke={channel}
			points={value.bins[channel].map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ')} />)}
	</svg><dl><dt>{messages.samples}</dt><dd>{number.format(value.sampledPixels)}</dd><dt>{messages.low}</dt><dd>{number.format(value.lowClippedPixels)}</dd>
		<dt>{messages.high}</dt><dd>{number.format(value.highClippedPixels)}</dd></dl></div>;
}
