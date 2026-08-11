/**
 * SocialSignInButton - Social sign-in button with provider logo
 * Based on Figma design: node-id=11112-42108
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './SocialSignInButton.css';

export interface SocialSignInButtonProps {
  /**
   * Social provider type
   */
  provider: 'google' | 'facebook';
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Whether button is disabled
   */
  disabled?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * SocialSignInButton component - Button for social authentication
 */
export function SocialSignInButton({
  provider,
  onClick,
  disabled = false,
  className = '',
}: SocialSignInButtonProps) {
  const { theme } = useTheme();

  const style = {
    '--social-btn-bg': theme.background.surface.elevated,
    '--social-btn-border': theme.border.default,
    '--social-btn-text': theme.foreground.text.primary,
    '--social-btn-hover-bg': theme.background.surface.hover,
  } as React.CSSProperties;

  const providerConfig = {
    google: {
      text: 'Continue with Google',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      ),
    },
    facebook: {
      text: 'Continue with Facebook',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.668 4.533-4.668 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.47h-2.796v8.385C19.612 22.954 24 17.99 24 12z" fill="#1877F2"/>
        </svg>
      ),
    },
  };

  const config = providerConfig[provider];

  return (
    <button
      className={`social-sign-in-button ${className}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
      style={style}
    >
      <span className="social-sign-in-button__icon">{config.icon}</span>
      <span className="social-sign-in-button__text">{config.text}</span>
    </button>
  );
}

export default SocialSignInButton;
