import React from 'react';
import { Icon } from '../Icon';
import { ToolButton } from '../ToolButton';
import './ProjectThumbnail.css';

// Audacity logo SVG (grayscale headphones)
const AudacityLogo = () => (
  <svg width="64" height="65" viewBox="0 0 64 65" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M63.75 48.1044C63.75 55.9076 57.2768 62.2334 49.2916 62.2334C41.3065 62.2334 34.8333 55.9076 34.8333 48.1044C34.8333 40.3012 41.3065 33.9755 49.2916 33.9755C57.2768 33.9755 63.75 40.3012 63.75 48.1044Z" fill="#C0C5CE"/>
    <path d="M32.1542 0C19.0551 0 8.43626 10.7189 8.43624 23.9412C8.43625 25.8815 8.66529 28.4361 9.09693 30.2427H10.113C9.92834 29.1257 9.83141 27.3059 9.83141 26.1289C9.83144 15.7589 17.3272 7.35236 26.5735 7.35229C35.8199 7.35229 43.3155 15.7589 43.3155 26.1289C43.3155 27.1144 43.2477 29.0844 43.1173 30.0289H55.3356C55.6869 28.39 55.8721 25.6862 55.8721 23.9412C55.8721 10.7189 45.2532 1.73515e-05 32.1542 0Z" fill="#C0C5CE"/>
    <path d="M0.25 48.1044C0.25 56.0106 6.58251 62.4199 14.3941 62.4199V33.789C6.58251 33.789 0.25 40.1983 0.25 48.1044Z" fill="#C0C5CE"/>
    <path d="M27.4195 31.1503L32.6764 48.1044L27.4195 64.976L22.4723 48.1044L27.4195 31.1503Z" fill="#C0C5CE"/>
    <path d="M19.9817 39.0219L22.7734 48.1044L19.9817 57.31L16.5873 48.1044L19.9817 39.0219Z" fill="#C0C5CE"/>
  </svg>
);

export interface ProjectThumbnailProps {
  /**
   * Project title
   */
  title?: string;
  /**
   * Date/timestamp text (e.g., "TODAY", "YESTERDAY")
   */
  dateText?: string;
  /**
   * Project thumbnail image URL
   */
  thumbnailUrl?: string;
  /**
   * Whether this is the "New project" card
   */
  isNewProject?: boolean;
  /**
   * Whether this is a cloud project (shows cloud icon badge)
   */
  isCloudProject?: boolean;
  /**
   * Whether the project is currently uploading to the cloud (shows upload icon)
   */
  isUploading?: boolean;
  /**
   * Whether this thumbnail represents the project that's currently open in
   * the editor. Adds an accent border + "CURRENT" badge so the user can
   * tell at a glance which project the toolbar/canvas is editing.
   */
  isCurrent?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Context menu button click handler
   */
  onContextMenu?: (e: React.MouseEvent) => void;
  /**
   * Optional className for custom styling
   */
  className?: string;
}

/**
 * ProjectThumbnail component
 * - Shows project preview with title and date
 * - Special "New project" variant with plus icon
 * - Fixed dimensions: 234px × 142px
 * - Shows Audacity logo when no thumbnail is provided
 */
export function ProjectThumbnail({
  title = 'New Project',
  dateText = 'TODAY',
  thumbnailUrl,
  isNewProject = false,
  isCloudProject = false,
  isUploading = false,
  isCurrent = false,
  onClick,
  onContextMenu,
  className = '',
}: ProjectThumbnailProps) {
  const [imageLoaded, setImageLoaded] = React.useState(false);

  // Generate small thumbnail URL for lazy loading placeholder
  // Replaces the size in the URL (e.g., /280/170 -> /28/17)
  const smallThumbnailUrl = thumbnailUrl?.replace(/\/(\d+)\/(\d+)/, (match, w, h) => {
    const width = Math.floor(parseInt(w) / 10);
    const height = Math.floor(parseInt(h) / 10);
    return `/${width}/${height}`;
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu && !isNewProject) {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e);
    }
  };

  return (
    <div className={`project-thumbnail ${isNewProject ? 'project-thumbnail--new' : ''} ${isCurrent ? 'project-thumbnail--current' : ''} ${className}`}>
      <button
        className="project-thumbnail__button"
        onClick={onClick}
        onContextMenu={handleContextMenu}
        type="button"
      >
        <div className="project-thumbnail__image">
          {isNewProject ? (
            <Icon name="plus" size={40} className="project-thumbnail__plus-icon" />
          ) : thumbnailUrl ? (
            <>
              {/* Small blurred thumbnail as placeholder */}
              {!imageLoaded && smallThumbnailUrl && (
                <img
                  src={smallThumbnailUrl}
                  alt=""
                  className="project-thumbnail__img project-thumbnail__img--placeholder"
                  aria-hidden="true"
                />
              )}
              {/* Full resolution image */}
              <img
                src={thumbnailUrl}
                alt={title}
                className="project-thumbnail__img"
                onLoad={() => setImageLoaded(true)}
                style={{ display: imageLoaded ? 'block' : 'none' }}
              />
            </>
          ) : (
            <div className="project-thumbnail__placeholder">
              <AudacityLogo />
            </div>
          )}
          {(isCloudProject || isUploading) && !isNewProject && (
            <div className={`project-thumbnail__cloud-badge ${isUploading ? 'project-thumbnail__cloud-badge--uploading' : ''}`}>
              <Icon name={isUploading ? 'cloud' : 'cloud-filled'} size={16} />
            </div>
          )}
          {isCurrent && !isNewProject && (
            <div className="project-thumbnail__current-badge">CURRENT</div>
          )}
        </div>
        <div className="project-thumbnail__info">
          <div className="project-thumbnail__title">{title}</div>
          {!isNewProject && <div className="project-thumbnail__date">{dateText}</div>}
        </div>
      </button>
      {onContextMenu && !isNewProject && (
        <div
          className="project-thumbnail__context-btn"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e);
          }}
        >
          <ToolButton
            icon="menu"
            size="small"
            onClick={() => {}}
          />
        </div>
      )}
    </div>
  );
}
