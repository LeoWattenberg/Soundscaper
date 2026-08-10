import { Icon } from '@dilsonspickles/components';
import React from 'react';

import { trackFolderRowTabIndex } from './track-folder-ui-model.ts';

/**
 * One folder header row in the timeline track list. The row is a treeitem in
 * the flattened folder tree; nesting is conveyed through level, position, and
 * set size, and the visual indent follows the level. Folder mute and solo are
 * authoritative folder state; the owned bus stays neutral behind them.
 */
export function TrackFolderRow({
	row,
	plan,
	copy,
	blocked,
	selected,
	activeFolderId,
	panelWidth,
	onSelect,
	onKeyDown,
	onToggleCollapsed,
	onSetFlag,
	onMenu,
}) {
	const label = React.useMemo(() => (copy.trackFolderRowLabel || 'Folder {name}, level {level}')
		.replace('{name}', row.name)
		.replace('{level}', String(row.level)), [copy.trackFolderRowLabel, row.name, row.level]);
	return (
		<div
			id={row.domId}
			className={`audio-editor-track-folder-row${selected ? ' is-selected' : ''}${row.hidden ? ' is-hidden' : ''}`}
			data-track-folder-row
			data-folder-id={row.id}
			role="treeitem"
			aria-label={label}
			aria-level={row.level}
			aria-posinset={row.posInSet}
			aria-setsize={row.setSize}
			aria-expanded={!row.collapsed}
			aria-selected={selected}
			tabIndex={trackFolderRowTabIndex(row, activeFolderId, plan)}
			style={{ '--track-folder-level': row.level }}
			onClick={() => onSelect(row.id)}
			onKeyDown={(event) => onKeyDown(event, row.id)}
			onContextMenu={(event) => {
				event.preventDefault();
				onMenu(row.id, { x: event.clientX, y: event.clientY });
			}}
		>
			<div className="audio-editor-track-folder-row__panel" style={{ width: panelWidth }}>
				<button
					type="button"
					className="audio-editor-track-folder-row__chevron"
					aria-label={row.collapsed ? copy.expandTrackFolder : copy.collapseTrackFolder}
					disabled={blocked}
					tabIndex={-1}
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapsed(row.id);
					}}
				>
					<Icon name={row.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
				</button>
				<span className="audio-editor-track-folder-row__name">{row.name}</span>
				<span className="audio-editor-track-folder-row__controls">
					<button
						type="button"
						className="audio-editor-track-folder-row__toggle"
						aria-label={copy.muteTrackFolder}
						aria-pressed={row.mute}
						disabled={blocked}
						tabIndex={-1}
						onClick={(event) => {
							event.stopPropagation();
							onSetFlag(row.id, 'mute', !row.mute);
						}}
					>M</button>
					<button
						type="button"
						className="audio-editor-track-folder-row__toggle"
						aria-label={copy.soloTrackFolder}
						aria-pressed={row.solo}
						disabled={blocked}
						tabIndex={-1}
						onClick={(event) => {
							event.stopPropagation();
							onSetFlag(row.id, 'solo', !row.solo);
						}}
					>S</button>
					<button
						type="button"
						className="audio-editor-track-folder-row__toggle"
						aria-label={copy.hideTrackFolder}
						aria-pressed={row.hidden}
						disabled={blocked}
						tabIndex={-1}
						onClick={(event) => {
							event.stopPropagation();
							onSetFlag(row.id, 'hidden', !row.hidden);
						}}
					>H</button>
				</span>
			</div>
			<div className="audio-editor-track-folder-row__lane" aria-hidden="true" />
		</div>
	);
}
