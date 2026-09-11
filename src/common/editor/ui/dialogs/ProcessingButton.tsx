/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';
import '@soundscaper/design-system/Button/Button.css';

/** The design-system button styling with native ARIA and data attributes preserved. */
export function ProcessingButton({ variant = 'secondary', children, className = '', disabled,
	type = 'button', ...attributes
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: 'primary' | 'secondary' }) {
	const { theme } = useTheme();
	const colors = theme.background.control.button[variant];
	const style = {
		'--button-bg-idle': colors.idle, '--button-bg-hover': colors.hover,
		'--button-bg-active': colors.active, '--button-bg-disabled': colors.disabled,
		'--button-text-color': theme.foreground.text.primary,
	} as CSSProperties;
	return <button type={type} className={`button button--${variant} button--default ${disabled ? 'button--disabled' : ''} ${className}`}
		disabled={disabled} style={style} {...attributes}>
		<span className="button__text">{children}</span>
	</button>;
}
