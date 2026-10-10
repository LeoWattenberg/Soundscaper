/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

type ReviewCrop = Readonly<{ left: number; top: number; right: number; bottom: number }>;

/** One admitted contact owns a crop gesture until its capture ends. */
export default function DraggableCropOverlay({ crop, label, onCrop }: Readonly<{
	crop: ReviewCrop;
	label: string;
	onCrop: (crop: ReviewCrop) => unknown;
}>) {
	const activePointer = useRef<number | null>(null);
	const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const bounds = event.currentTarget.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		const width = 1 - crop.left - crop.right;
		const height = 1 - crop.top - crop.bottom;
		const left = boundedPosition((event.clientX - bounds.left) / bounds.width - width / 2, width);
		const top = boundedPosition((event.clientY - bounds.top) / bounds.height - height / 2, height);
		void onCrop({ left, top, right: unit(1 - width - left), bottom: unit(1 - height - top) });
	};
	const release = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (activePointer.current !== event.pointerId) return;
		activePointer.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};
	return <div className="kw-local-assistance__crop-overlay" aria-label={label}
		onPointerDown={(event) => {
			if (event.button !== 0 || event.isPrimary === false || activePointer.current !== null) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			activePointer.current = event.pointerId;
			move(event);
		}}
		onPointerMove={(event) => {
			if (activePointer.current === event.pointerId
				&& event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
		}}
		onPointerUp={release} onPointerCancel={release}
		onLostPointerCapture={(event) => {
			if (activePointer.current === event.pointerId) activePointer.current = null;
		}}
		style={{ paddingLeft: `${String(crop.left * 100)}%`,
			paddingRight: `${String(crop.right * 100)}%`,
			paddingTop: `${String(crop.top * 100)}%`,
			paddingBottom: `${String(crop.bottom * 100)}%` }}><span /></div>;
}

function boundedPosition(value: number, extent: number): number {
	return unit(Math.min(1 - extent, Math.max(0, value)));
}

function unit(value: number): number {
	return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
