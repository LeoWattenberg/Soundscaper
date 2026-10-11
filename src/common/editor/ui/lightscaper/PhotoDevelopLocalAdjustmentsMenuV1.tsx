/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';
import { photoDevelopCopy } from '../../../i18n/lightscaper-develop-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../../i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../../i18n/lightscaper-develop-repair-spots-copy.ts';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
export type PhotoDevelopLocalAdjustmentKindV1 = 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range' | 'brush' | 'masks';
export interface PhotoDevelopLocalAdjustmentsMenuPropsV1 {
	readonly locale: string;
	readonly disabled: boolean;
	readonly isCurrent: () => boolean;
	readonly resolution?: Readonly<{ value: PhotoDevelopResolutionV1; fullAvailable: boolean; onChange: (value: PhotoDevelopResolutionV1) => void }>;
	readonly localAdjustments?: Readonly<{ onOpen: (kind: PhotoDevelopLocalAdjustmentKindV1) => void }>;
	readonly repairs?: Readonly<{ available: boolean; onOpen: () => void }>;
}
/** Shared menu entries only; the Workspace opens lazy owners on explicit demand. */
export default function PhotoDevelopLocalAdjustmentsMenuV1(props: PhotoDevelopLocalAdjustmentsMenuPropsV1) {
	const latest = useRef(props), live = useRef(true); latest.current = props;
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const current = () => live.current && latest.current === props && !props.disabled && props.isCurrent();
	const preview = photoDevelopCopy(props.locale), repair = photoDevelopRepairSpotsCopy(props.locale);
	const open = (kind: PhotoDevelopLocalAdjustmentKindV1) => { if (current()) props.localAdjustments?.onOpen(kind); };
	return <>
		{props.resolution && <>
			<button type="button" disabled={props.disabled} aria-pressed={props.resolution.value === 'proxy'} onClick={() => { if (current()) props.resolution?.onChange('proxy'); }}>{preview.fitResolution}</button>
			<button type="button" disabled={props.disabled || !props.resolution.fullAvailable} aria-pressed={props.resolution.value === 'full'} onClick={() => {
				if (current() && props.resolution?.fullAvailable) props.resolution.onChange('full');
			}}>{preview.fullResolution}</button>
		</>}
		{props.localAdjustments && (['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range'] as const).map(kind =>
			<button key={kind} type="button" disabled={props.disabled} onClick={() => { open(kind); }}>{photoDevelopLocalAdjustmentsCopy(props.locale, kind).menu}</button>)}
		{props.localAdjustments && <><button type="button" disabled={props.disabled} onClick={() => { open('brush'); }}>{photoDevelopBrushMaskCopy(props.locale).menu}</button>
			<button type="button" disabled={props.disabled} onClick={() => { open('masks'); }}>{photoDevelopMaskManagementCopy(props.locale).menu}</button></>}
		{props.repairs && <button type="button" disabled={props.disabled || !props.repairs.available} title={props.repairs.available ? undefined : repair.noOriginal}
			onClick={() => { if (current() && props.repairs?.available) props.repairs.onOpen(); }}>{repair.menu}</button>}
	</>;
}
