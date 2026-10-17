/* SPDX-License-Identifier: AGPL-3.0-only */

import './timeline-labels.css';

// Upstream LabelItem's ears, stalks and text straps, with host-owned gestures.
const COLORS = {
	blue: '#66A3FF', violet: '#9996FC', magenta: '#DA8CCC', red: '#F08080',
	orange: '#FF9E65', yellow: '#E8C050', green: '#74BE59', teal: '#34B494', cyan: '#48BECF',
};
const EAR_PATHS = {
	left: 'M0.723608 1.44722L7 14V0H1.61827C0.874886 0 0.391157 0.782314 0.723608 1.44722Z',
	right: 'M6.27639 1.44722L0 14V0H5.38173C6.12511 0 6.60884 0.782314 6.27639 1.44722Z',
};

export function TimelineLabelChrome({ text, point, width, stalkHeight, metrics, trackColor,
	selected, leftNeighbor, rightNeighbor, leftNeighborSelected, onGesture, onSelect, onEdit, editing, children }) {
	const color = COLORS[trackColor] || (/^#[\da-f]{3,8}$/iu.test(trackColor || '') ? trackColor : COLORS.blue);
	const bannerLeft = point ? metrics.earWidth + metrics.pointFlagGap : 0;
	const ear = (side, left) => <div className={`label-marker__${side}-ear`}
		data-label-ear={side} style={{ left, width: metrics.earWidth, height: metrics.earHeight }} onMouseDown={(event) => onGesture(event, side)}>
		<svg width={metrics.earWidth} height={metrics.earHeight} viewBox="0 0 7 14" preserveAspectRatio="none" aria-hidden="true">
			<path d={EAR_PATHS[side]} />
		</svg>
	</div>;
	const stalk = (side, left, shared) => <div className={`label-marker__${side}-stalk`}
		data-label-stalk={side} data-shared-boundary={shared ? 'true' : undefined}
		style={{ left: left - 4, height: stalkHeight, cursor: point && !shared ? 'move' : 'ew-resize' }}
		onMouseDown={(event) => onGesture(event, shared ? `shared-${side}` : point ? 'move-point' : side)}>
		<div className="label-marker__stalk-line" />
	</div>;
	return <div className={`label-marker audio-editor-upstream-label ${point ? 'label-marker--point' : 'label-marker--region'} ${selected ? 'label-marker--active' : ''}`}
		style={{ '--label-track-color': color, '--label-font-size': `${metrics.fontSizePx}px`,
			'--label-banner-height': `${metrics.bannerHeight}px`, '--label-padding': `${metrics.padX}px`,
			width: point ? 1 : width, height: stalkHeight }}
		onClick={(event) => { if (!event.target || event.target.closest('[data-label-banner]')) onSelect(event); }}>
		{(!leftNeighbor || selected) && ear('left', -metrics.earWidth)}
		{!(leftNeighbor && !selected && leftNeighborSelected) && stalk('left', 0, Boolean(leftNeighbor))}
		{point ? ear('right', 1) : (!rightNeighbor || selected) && <>
			{stalk('right', width, Boolean(rightNeighbor))}{ear('right', width + 1)}
		</>}
		<div className="label-marker__label-box" data-label-banner
			style={{ left: bannerLeft, width }}
			onMouseDown={(event) => {
				if (event.button !== 0 || editing) return;
				onSelect(event);
				if (event.detail < 2 || event.detail === undefined) onGesture(event, 'move');
			}}
			onDoubleClick={(event) => { event.stopPropagation(); onEdit(); }}>
			{editing ? children : <div className="label-marker__label-text">{text}</div>}
		</div>
	</div>;
}
