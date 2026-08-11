/**
 * CloudProjectIndicator Component
 *
 * Displays a cloud icon badge to indicate that the current project is synced to the cloud
 * - 24px circular blue badge
 * - 16px white cloud icon centered
 * - Drop shadow for elevation
 */

import React from 'react';
import './CloudProjectIndicator.css';

export interface CloudProjectIndicatorProps {
  /**
   * Upload state - when true, shows upload icon instead of cloud
   */
  isUploading?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * CloudProjectIndicator - Shows a cloud icon badge for cloud-synced projects
 */
export function CloudProjectIndicator({
  isUploading = false,
  className = '',
}: CloudProjectIndicatorProps) {
  // F435 = cloud-outline (saved), EF25 = cloud-upload (uploading)
  const icon = isUploading ? '\uEF25' : '\uF435';

  return (
    <div className={`cloud-project-indicator ${className}`}>
      <div className="cloud-project-indicator__icon">{icon}</div>
    </div>
  );
}

export default CloudProjectIndicator;
