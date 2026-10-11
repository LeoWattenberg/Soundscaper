/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopPresentationV2, preparePhotoDevelopPresentationViewV2, type PhotoDevelopPresentationSnapshotV2 } from '../../controller/shared/photo-library-develop-presentation-v2.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PixelPreviewPresentationReaderV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../photo-library-develop-port-v2.ts';
import type { PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';
import type { PhotoDevelopCopyV1 } from '../../../i18n/lightscaper-develop-copy.ts';
import PhotoDevelopMaskOverlayV1 from './PhotoDevelopMaskOverlayV1.tsx';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';

export interface PhotoDevelopPreviewPropsV2 {
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV2;
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly withOriginalFrame?: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly resolution?: PhotoDevelopResolutionV1;
	readonly revision?: number;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly beforePresent: Promise<void>;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
	readonly messages: PhotoDevelopCopyV1;
	readonly locale: string;
	readonly maskOverlay?: Readonly<PhotoDevelopMaskOverlaySelectionV1>;
	readonly isCurrent?: () => boolean;
}
const MODES = ['compare', 'before', 'after', 'split'] as const;
type PreviewMode = typeof MODES[number];
export default function PhotoDevelopPreviewV2(props: PhotoDevelopPreviewPropsV2) {
	const { readPreview, withOriginalFrame, loadProxy, beforePresent, registerRetirement } = props;
	const sourceRef = useRef({ readPreview, withOriginalFrame, loadProxy, beforePresent, receiver: props });
	if (sourceRef.current.readPreview !== readPreview || sourceRef.current.withOriginalFrame !== withOriginalFrame
		|| sourceRef.current.loadProxy !== loadProxy || sourceRef.current.beforePresent !== beforePresent) {
		sourceRef.current = { readPreview, withOriginalFrame, loadProxy, beforePresent, receiver: props };
	}
	const source = sourceRef.current;
	const owner = useMemo(() => new PhotoLibraryDevelopPresentationV2({ readPreview: pin(source.readPreview, source.receiver),
		withOriginalFrame: source.withOriginalFrame === undefined ? undefined : pin<PhotoLibraryDevelopOriginalPortV1['withFrame']>(source.withOriginalFrame, source.receiver),
		loadProxy: pin(source.loadProxy, source.receiver), beforePresent: source.beforePresent }), [source]);
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const lifetime = useRef(false);
	const registrationRef = useRef({ method: registerRetirement, receiver: props });
	if (registrationRef.current.method !== registerRetirement) registrationRef.current = { method: registerRetirement, receiver: props };
	const registration = registrationRef.current;
	const interaction = useMemo(() => ({ owner, photoId: props.photoId, develop: props.develop, revision: props.revision, resolution: props.resolution }), [owner, props.photoId, props.develop, props.revision, props.resolution]);
	const activeInteraction = useRef(interaction); activeInteraction.current = interaction;
	const before = useRef<HTMLCanvasElement>(null), after = useRef<HTMLCanvasElement>(null);
	const [view, setView] = useState(() => ({ owner, photoId: props.photoId, mode: 'compare' as PreviewMode, divider: 50 }));
	const selected = view.owner === owner && view.photoId === props.photoId ? view : { owner, photoId: props.photoId, mode: 'compare' as PreviewMode, divider: 50 };
	const rendered = useRef(selected); rendered.current = selected;
	const [snapshot, setSnapshot] = useState<PhotoDevelopPresentationSnapshotV2>(() => owner.snapshot());
	useLayoutEffect(() => {
		lifetime.current = true;
		const unsubscribe = owner.subscribe(setSnapshot);
		const unregister = Reflect.apply(registration.method, registration.receiver, [() => joinPhotoLibraryRetirementV1([retirement.current, owner.pause()])]) as () => void;
		return () => { lifetime.current = false; unsubscribe(); unregister(); retirement.current = joinPhotoLibraryRetirementV1([retirement.current, owner.pause()]);
			void retirement.current.catch(() => undefined); };
	}, [owner, registration]);
	useLayoutEffect(() => {
		let current = true;
		// Capture the complete request while this generation owns its targets,
		// before joining the predecessor or any externally supplied barrier.
		try {
			if (!before.current || !after.current) throw new Error('Develop targets are unavailable.');
			const prepared = preparePhotoDevelopPresentationViewV2({ photoId: props.photoId, develop: props.develop, revision: props.revision,
				resolution: props.resolution, before: before.current, after: after.current });
			void joinPhotoLibraryRetirementV1([retirement.current, owner.pause()]).then(() => {
				if (current) owner.setView(prepared);
			}).catch(() => { if (current) setSnapshot(Object.freeze({ status: 'failed', before: null, after: null, extent: null, error: 'The develop preview failed.' })); });
		} catch {
			setSnapshot(Object.freeze({ status: 'failed', before: null, after: null, extent: null, error: 'The develop preview failed.' }));
		}
		return () => { current = false; void owner.pause().catch(() => undefined); };
	}, [owner, props.photoId, props.develop, props.revision, props.resolution]);
	const { messages } = props, { mode, divider } = selected;
	const current = () => lifetime.current && activeInteraction.current === interaction && rendered.current === selected;
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
				<figcaption>{messages.after}</figcaption><div className="lightscaper-develop-image-plane"><canvas ref={after} width={0} height={0} role="img" aria-label={messages.after} data-photo-develop-after />
					{props.maskOverlay && snapshot.status === 'ready' && snapshot.extent && <PhotoDevelopMaskOverlayV1 key={`${props.photoId}:${props.revision ?? ''}`} develop={props.develop} selection={props.maskOverlay}
						source={snapshot.extent.before} extent={snapshot.extent.after} resolution={props.resolution ?? 'proxy'} locale={props.locale}
						registerRetirement={registerRetirement} isCurrent={() => current() && (props.isCurrent?.() ?? true)} />}
				</div></figure>
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

function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: PhotoDevelopPreviewPropsV2): Method {
	return ((...args: unknown[]): unknown => Reflect.apply(method, receiver, args) as unknown) as unknown as Method;
}
