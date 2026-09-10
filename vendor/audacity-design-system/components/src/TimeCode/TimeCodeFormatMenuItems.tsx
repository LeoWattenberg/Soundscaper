import React from 'react';
import { ContextMenuItem } from '../ContextMenuItem';
import type { TimeCodeFormat, TimeCodeFormatOption } from './time-code-formats';

interface TimeCodeFormatMenuItemsProps {
	readonly options: readonly TimeCodeFormatOption[];
	readonly format: TimeCodeFormat;
	readonly onSelect: (format: TimeCodeFormat) => void;
}

export function TimeCodeFormatMenuItems({ options, format, onSelect }: TimeCodeFormatMenuItemsProps) {
	const item = (option: TimeCodeFormatOption) => <ContextMenuItem
		key={option.format} label={option.label} checked={format === option.format}
		onClick={() => onSelect(option.format)} />;
	return <>
		{options.filter((option) => !option.group).map(item)}
		{(['Video frames', 'CD frames'] as const).map((group) => {
			const children = options.filter((option) => option.group === group);
			return children.length ? <ContextMenuItem key={group} label={group} hasSubmenu
				checked={children.some((option) => option.format === format)}>
				{children.map(item)}
			</ContextMenuItem> : null;
		})}
	</>;
}
