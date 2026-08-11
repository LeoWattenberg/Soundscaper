/**
 * SignInActionBar - Sign in/out action bar for dialogs
 */

import React from 'react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import './SignInActionBar.css';

export interface SignInActionBarProps {
  /**
   * Whether the user is signed in
   */
  signedIn?: boolean;
  /**
   * User's display name (when signed in)
   */
  userName?: string;
  /**
   * User's profile picture URL (when signed in)
   */
  userAvatar?: string;
  /**
   * Callback when sign out button is clicked
   */
  onSignOut?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * SignInActionBar component - Shows sign-in status with avatar and sign-out button
 */
export function SignInActionBar({
  signedIn = false,
  userName = 'User',
  userAvatar,
  onSignOut,
  className = '',
}: SignInActionBarProps) {
  if (signedIn) {
    return (
      <div className={`sign-in-action-bar sign-in-action-bar--signed-in ${className}`}>
        <div className="sign-in-action-bar__user-info">
          <div className="sign-in-action-bar__avatar">
            {userAvatar ? (
              <img src={userAvatar} alt={userName} />
            ) : (
              <Icon name="user" size={16} />
            )}
          </div>
          <div className="sign-in-action-bar__name">
            {userName}
          </div>
        </div>
        <Button
          variant="secondary"
          size="default"
          onClick={onSignOut}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className={`sign-in-action-bar sign-in-action-bar--signed-out ${className}`}>
      <div className="sign-in-action-bar__user-info">
        <div className="sign-in-action-bar__avatar sign-in-action-bar__avatar--placeholder">
          <Icon name="user" size={16} />
        </div>
        <div className="sign-in-action-bar__name">
          You are not signed in
        </div>
      </div>
    </div>
  );
}

export default SignInActionBar;
