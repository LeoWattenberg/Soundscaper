/* SPDX-License-Identifier: AGPL-3.0-only */
import { useRef, useState } from 'react';
import { TrackColorPicker } from '../timeline/TimelineFlyouts.jsx';
import { colorName } from '../timeline/TimelineOverlayComponents.jsx';

interface Props {
	readonly color?: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onChange: (color: string) => void;
}

/** Share the track palette instead of inventing numbered color names. */
export default function ClipPropertiesColorPicker({ color, copy, disabled, onChange }: Props) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const close = () => { setPosition(null); trigger.current?.focus({ preventScroll: true }); };
	const label = color === 'mixed' ? copy.clipMixed : !color || color === 'track' || color === 'auto' ? copy.followTrackColor : colorName(copy, color);
	return <>
		<button ref={trigger} type="button" className="clip-properties__palette-trigger" aria-label={copy.clipColor}
			aria-haspopup="menu" aria-expanded={Boolean(position)} disabled={disabled} data-open-clip-color
			onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setPosition({ x: bounds.left, y: bounds.bottom }); }}>
			{label}
		</button>
		<TrackColorPicker isOpen={Boolean(position)} x={position?.x ?? 0} y={position?.y ?? 0} color={color === 'track' ? 'auto' : color}
			copy={{ ...copy, trackColor: copy.clipColor }} onChange={onChange} onClose={close} onFollowTrackColor={() => onChange('auto')} />
	</>;
}
