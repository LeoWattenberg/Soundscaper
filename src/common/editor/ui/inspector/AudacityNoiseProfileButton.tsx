/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { type ReactNode } from 'react';
import { Button, type ButtonProps } from '@soundscaper/design-system/Button';

interface NoiseProfileButtonProps {
	readonly label: string;
	readonly children: ReactNode;
	readonly disabled?: boolean;
	readonly onClick?: ButtonProps['onClick'];
}

/** Keep Audacity's caption while announcing whether capture replaces a profile. */
export default function AudacityNoiseProfileButton({ label, children, disabled, onClick }: NoiseProfileButtonProps) {
	return <Button disabled={disabled} onClick={onClick}>
		<span aria-hidden="true">{children}</span>
		<span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{label}</span>
	</Button>;
}
