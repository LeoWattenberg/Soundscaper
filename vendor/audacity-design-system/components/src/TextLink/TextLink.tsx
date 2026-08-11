/**
 * TextLink - Inline text link component
 * Based on Figma design: node-id=10122-3609
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './TextLink.css';

export interface TextLinkProps {
  /**
   * Link text
   */
  children: React.ReactNode;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * href attribute (for actual links)
   */
  href?: string;
  /**
   * Target attribute
   */
  target?: '_blank' | '_self' | '_parent' | '_top';
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TextLink component - Inline text link with underline
 */
export function TextLink({
  children,
  onClick,
  href,
  target,
  className = '',
}: TextLinkProps) {
  const { theme } = useTheme();

  const style = {
    '--text-link-color': theme.foreground.text.link,
    '--text-link-color-hover': theme.foreground.text.link,
    '--text-link-color-active': theme.foreground.text.link,
  } as React.CSSProperties;

  const handleClick = (e: React.MouseEvent) => {
    if (onClick && !href) {
      e.preventDefault();
      onClick();
    } else if (onClick) {
      onClick();
    }
  };

  if (href) {
    return (
      <a
        href={href}
        target={target}
        onClick={handleClick}
        className={`text-link ${className}`}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-link text-link--button ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

export default TextLink;
