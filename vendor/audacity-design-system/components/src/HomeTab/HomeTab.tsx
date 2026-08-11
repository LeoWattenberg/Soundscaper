import React from 'react';
import { SearchField } from '../SearchField';
import { Icon } from '../Icon';
import { ProjectThumbnail } from '../ProjectThumbnail';
import { AudioFileThumbnail } from '../AudioFileThumbnail';
import { Button } from '../Button';
import { Dropdown } from '../Dropdown';
import { PluginCard } from '../PluginCard';
import { CustomScrollbar } from '../CustomScrollbar';
import { useTheme } from '../ThemeProvider';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import { getProjects, saveProject, deleteProject, type StoredProject } from '../utils/projectStorage';
import { WaveformPreview } from '../WaveformPreview';
import { generateSpeechWaveform } from '../utils/waveform';
import './HomeTab.css';

export interface CloudAudioFile {
  id: string;
  title: string;
  dateText: string;
  duration: string;
  size: string;
  blobUrl?: string;
  waveformData?: number[];
}

export interface HomeTabProps {
  isSignedIn?: boolean;
  userName?: string;
  userAvatarUrl?: string;
  onCreateAccount?: () => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
  /** Called when the user clicks "Manage account" on the built-in
   *  audio.com card. If omitted, opens https://audio.com in a new tab. */
  onManageAccount?: () => void;
  /** Called when the user picks "View in audio.com" from a cloud project's
   *  context menu (right-click on the thumbnail or kebab menu). Receives
   *  the project id. If omitted, the menu item is a no-op. */
  onViewProjectOnCloud?: (projectId: string) => void;
  onNewProject?: (projectId: string) => void;
  onOpenProject?: (projectId: string) => void;
  onOpenOther?: () => void;
  onDeleteProject?: (projectId: string) => void;
  onSearch?: (query: string) => void;
  className?: string;
  projects?: StoredProject[];
  /**
   * Project ID currently open in the editor. The matching thumbnail/row
   * gets a "CURRENT" badge + accent border so users can spot which
   * project the editor is editing without leaving the home tab.
   */
  currentProjectId?: string | null;
  audioFiles?: CloudAudioFile[];
  onDeleteAudioFile?: (id: string) => void;
  /** Render-slot for any extra account cards on the "My accounts" page
   *  (e.g. the sandbox supplies a MuseHub card here). Each child should
   *  render its own `<div class="home-tab__accounts-section">` so styling
   *  stays consistent with the built-in Audio.com card. */
  extraAccountsSections?: React.ReactNode;
}

export function HomeTab({
  isSignedIn = false,
  userName,
  userAvatarUrl,
  onCreateAccount,
  onSignIn,
  onSignOut,
  onManageAccount,
  onViewProjectOnCloud,
  onNewProject,
  onOpenProject,
  onOpenOther,
  onDeleteProject,
  onSearch,
  className = '',
  projects: externalProjects,
  currentProjectId,
  audioFiles: externalAudioFiles,
  onDeleteAudioFile,
  extraAccountsSections,
}: HomeTabProps) {
  const { theme } = useTheme();
  const [activeSidebarItem, setActiveSidebarItem] = React.useState<'my-accounts' | 'project' | 'plugins' | 'learn'>('project');
  const [activeSection, setActiveSection] = React.useState<'cloud-projects' | 'new-recent' | 'cloud-audio'>('new-recent');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [audioPage, setAudioPage] = React.useState(1);
  const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; itemId: string; isCloudItem: boolean; itemType?: 'project' | 'audio' } | null>(null);
  const [storedProjects, setStoredProjects] = React.useState<StoredProject[]>([]);
  const [pluginsSearchQuery, setPluginsSearchQuery] = React.useState('');
  const [pluginsCategory, setPluginsCategory] = React.useState('all');
  const [pluginsLoading, setPluginsLoading] = React.useState(false);
  const [availablePlugins, setAvailablePlugins] = React.useState<any[]>([]);
  const pluginsScrollRef = React.useRef<HTMLDivElement>(null);
  const itemsPerPage = 12;

  // Load projects from localStorage on mount (unless external projects provided)
  React.useEffect(() => {
    if (externalProjects) {
      setStoredProjects(externalProjects);
    } else {
      const projects = getProjects();
      setStoredProjects(projects);
    }
  }, [externalProjects]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Reload projects from localStorage
    const projects = getProjects();
    setStoredProjects(projects);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  };

  const handleDeleteProject = (id: string) => {
    if (onDeleteProject) {
      onDeleteProject(id);
    } else {
      deleteProject(id);
      setStoredProjects(getProjects());
    }
  };

  const handleCreateNewProject = () => {
    // Generate unique project ID
    const projectId = `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create new project
    const newProject: StoredProject = {
      id: projectId,
      title: `New Project ${new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })}`,
      dateCreated: Date.now(),
      dateModified: Date.now(),
      isCloudProject: false,
      thumbnailUrl: undefined,
    };

    // Save to localStorage
    saveProject(newProject);

    // Reload projects list
    setStoredProjects(getProjects());

    // Call parent onNewProject callback with project ID to open it
    if (onNewProject) {
      onNewProject(projectId);
    }
  };

  // Helper to format date for display
  const formatDateText = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'TODAY';
    if (days === 1) return 'YESTERDAY';
    if (days < 7) return `${days} DAYS AGO`;
    if (days < 14) return '1 WEEK AGO';
    if (days < 30) return `${Math.floor(days / 7)} WEEKS AGO`;
    if (days < 60) return '1 MONTH AGO';
    return `${Math.floor(days / 30)} MONTHS AGO`;
  };

  // Audacity logo SVG for project thumbnails
  const AudacityLogo = () => (
    <svg width="64" height="65" viewBox="0 0 64 65" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M63.75 48.1044C63.75 55.9076 57.2768 62.2334 49.2916 62.2334C41.3065 62.2334 34.8333 55.9076 34.8333 48.1044C34.8333 40.3012 41.3065 33.9755 49.2916 33.9755C57.2768 33.9755 63.75 40.3012 63.75 48.1044Z" fill="#C0C5CE"/>
      <path d="M32.1542 0C19.0551 0 8.43626 10.7189 8.43624 23.9412C8.43625 25.8815 8.66529 28.4361 9.09693 30.2427H10.113C9.92834 29.1257 9.83141 27.3059 9.83141 26.1289C9.83144 15.7589 17.3272 7.35236 26.5735 7.35229C35.8199 7.35229 43.3155 15.7589 43.3155 26.1289C43.3155 27.1144 43.2477 29.0844 43.1173 30.0289H55.3356C55.6869 28.39 55.8721 25.6862 55.8721 23.9412C55.8721 10.7189 45.2532 1.73515e-05 32.1542 0Z" fill="#C0C5CE"/>
      <path d="M0.25 48.1044C0.25 56.0106 6.58251 62.4199 14.3941 62.4199V33.789C6.58251 33.789 0.25 40.1983 0.25 48.1044Z" fill="#C0C5CE"/>
      <path d="M27.4195 31.1503L32.6764 48.1044L27.4195 64.976L22.4723 48.1044L27.4195 31.1503Z" fill="#C0C5CE"/>
      <path d="M19.9817 39.0219L22.7734 48.1044L19.9817 57.31L16.5873 48.1044L19.9817 39.0219Z" fill="#C0C5CE"/>
    </svg>
  );

  // Spinner component
  const Spinner = () => {
    const accentColor = theme.accent.primary;
    const gaugeColor = theme.background.control.panKnob.gauge;

    return (
      <div className="home-tab__spinner">
        <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          {/* Background arc (light) */}
          <circle
            cx="24"
            cy="24"
            r="18"
            stroke={gaugeColor}
            strokeWidth="4"
            fill="none"
          />
          {/* Animated foreground arc (solid) */}
          <circle
            cx="24"
            cy="24"
            r="18"
            stroke={accentColor}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="28 85"
            transform="rotate(0 24 24)"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 24 24"
              to="360 24 24"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>
    );
  };

  // Cloud projects - filter real stored projects that have been saved to cloud
  const allCloudProjects = storedProjects.filter(p => p.isCloudProject);

  const totalPages = Math.ceil(allCloudProjects.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentProjects = allCloudProjects.slice(startIndex, endIndex);

  const allAudioFiles: CloudAudioFile[] = externalAudioFiles ?? [];

  const audioTotalPages = Math.ceil(allAudioFiles.length / itemsPerPage);
  const audioStartIndex = (audioPage - 1) * itemsPerPage;
  const audioEndIndex = audioStartIndex + itemsPerPage;
  const currentAudioFiles = allAudioFiles.slice(audioStartIndex, audioEndIndex);

  // Use real waveform data if available, otherwise generate a placeholder
  const audioWaveforms = React.useMemo(() => {
    return currentAudioFiles.map((f) => {
      if (f.waveformData && f.waveformData.length > 0) return f.waveformData;
      const [mins, secs] = f.duration.split(':').map(Number);
      const duration = (mins || 0) * 60 + (secs || 0);
      return generateSpeechWaveform(Math.max(1, duration), 500);
    });
  }, [currentAudioFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to page 1 when switching sections
  React.useEffect(() => {
    setCurrentPage(1);
    setAudioPage(1);
  }, [activeSection]);

  // Generate page numbers with ellipsis - always shows 7 slots for consistent width
  const getPageNumbers = (total: number, current: number) => {
    const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
    const maxVisible = 7; // Always show exactly 7 slots

    if (total <= maxVisible) {
      // Show all pages if total is small, pad with empty slots
      const actualPages = Array.from({ length: total }, (_, i) => i + 1);
      return actualPages;
    }

    // Always 7 slots: first ... middle3 ... last
    // Pattern: 1 ... x x x ... last = 7 items

    if (current <= 3) {
      // Near start: 1 2 3 4 5 ... last
      pages.push(1, 2, 3, 4, 5, 'ellipsis-end', total);
    } else if (current >= total - 2) {
      // Near end: 1 ... last-4 last-3 last-2 last-1 last
      pages.push(1, 'ellipsis-start', total - 4, total - 3, total - 2, total - 1, total);
    } else {
      // Middle: 1 ... current-1 current current+1 ... last
      pages.push(1, 'ellipsis-start', current - 1, current, current + 1, 'ellipsis-end', total);
    }

    return pages;
  };

  // Plugin data
  const allPluginsData = [
    { id: 'graillon-3', name: 'Graillon 3', description: 'Real-time vocal tuner', category: 'generators', imageUrl: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=300&h=300&fit=crop' },
    { id: 'inner-pitch-2', name: 'Inner Pitch 2', description: 'Creative pitch-shifting plugin', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=300&h=300&fit=crop' },
    { id: 'voice-enhance', name: 'Voice Enhance Pro', description: 'Professional voice enhancement', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1589903308904-1010c2294adc?w=300&h=300&fit=crop' },
    { id: 'musefx', name: 'MuseFX', description: 'Essential mix effects collection', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1598653222000-6b7b7a552625?w=300&h=300&fit=crop' },
    { id: 'shape-it', name: 'Shape It', description: 'Parametric 10 band EQ', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=300&h=300&fit=crop' },
    { id: 'place-it', name: 'Place It', description: '10 band parametric EQ', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1614149162883-504ce0ecad82?w=300&h=300&fit=crop' },
    { id: 'borealis-le', name: 'BOREALIS-LE', description: 'FREE Light Edition of BOREALIS', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1551715398-f3f6ddbe1f00?w=300&h=300&fit=crop' },
    { id: 'space-echo', name: 'Space Echo', description: 'Vintage delay and reverb', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300&h=300&fit=crop' },
    { id: 'smooth-vocal', name: 'Smooth Vocal', description: 'Advanced de-essing tool', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1590845947670-c009801ffa74?w=300&h=300&fit=crop' },
    { id: 'clarity-plus', name: 'Clarity Plus', description: 'Intelligent sibilance control', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop' },
    { id: 'amp-studio', name: 'Amp Studio', description: 'Guitar amplifier simulation', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1556449895-a33c9dba33dd?w=300&h=300&fit=crop' },
    { id: 'pedal-board', name: 'Pedal Board', description: 'Virtual guitar effects pedals', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1606682116200-ab4f67753489?w=300&h=300&fit=crop' },
    { id: 'neutone-fx', name: 'Neutone FX', description: 'AI powered sound effects', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=300&h=300&fit=crop' },
    { id: 'spectrum-fx', name: 'Spectrum FX', description: 'Spectral sound design tools', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=300&h=300&fit=crop' },
    { id: 'dynamic-master', name: 'Dynamic Master', description: 'Professional dynamics control', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1598887142487-3c854d7c3de8?w=300&h=300&fit=crop' },
    { id: 'tone-shaper', name: 'Tone Shaper', description: 'Advanced tone sculpting', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1563330232-57114bb0823c?w=300&h=300&fit=crop' },
    { id: 'vintage-tape', name: 'Vintage Tape', description: 'Authentic tape saturation', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1603473219299-1c2cb6b09c38?w=300&h=300&fit=crop' },
    { id: 'analog-warmth', name: 'Analog Warmth', description: 'Classic analog character', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=300&h=300&fit=crop' },
    { id: 'drum-enhancer', name: 'Drum Enhancer', description: 'Powerful drum processing', category: 'effects', imageUrl: 'https://images.unsplash.com/photo-1571327073757-71d13c24de30?w=300&h=300&fit=crop' },
    { id: 'beat-forge', name: 'Beat Forge', description: 'Percussion design toolkit', category: 'generators', imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=300&h=300&fit=crop' },
    { id: 'tone-gen', name: 'Tone Generator', description: 'Multi-waveform tone generator', category: 'generators', imageUrl: undefined },
    { id: 'noise-gen', name: 'Noise Generator', description: 'White, pink, and brown noise', category: 'generators', imageUrl: undefined },
    { id: 'spectrum-analyzer', name: 'Spectrum Analyzer', description: 'Real-time frequency analysis', category: 'analyzers', imageUrl: undefined },
    { id: 'phase-meter', name: 'Phase Meter', description: 'Stereo phase correlation', category: 'analyzers', imageUrl: undefined },
  ];

  // Load plugins on mount (simulate API call)
  React.useEffect(() => {
    if (activeSidebarItem === 'plugins' && availablePlugins.length === 0) {
      setPluginsLoading(true);
      setTimeout(() => {
        setAvailablePlugins(allPluginsData);
        setPluginsLoading(false);
      }, 1500);
    }
  }, [activeSidebarItem]);

  // Filter plugins based on search and category
  const filteredPlugins = React.useMemo(() => {
    return availablePlugins.filter((plugin) => {
      const matchesCategory = pluginsCategory === 'all' || plugin.category === pluginsCategory;
      const matchesSearch = plugin.name.toLowerCase().includes(pluginsSearchQuery.toLowerCase()) ||
                           plugin.description.toLowerCase().includes(pluginsSearchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [availablePlugins, pluginsCategory, pluginsSearchQuery]);

  const style = {
    '--home-tab-bg': theme.background.surface.default,
    '--home-tab-sidebar-bg': theme.background.surface.default,
    '--home-tab-sidebar-border': theme.border.default,
    '--home-tab-sidebar-item-text': theme.foreground.text.primary,
    '--home-tab-sidebar-item-hover-bg': theme.background.surface.hover,
    '--home-tab-sidebar-item-active-bg': theme.background.surface.subtle,
    '--home-tab-content-bg': theme.background.surface.inset,
    '--home-tab-header-text': theme.foreground.text.primary,
    '--home-tab-section-btn-bg': theme.border.focus,
    '--home-tab-projects-grid-bg': theme.background.surface.inset,
    '--home-tab-card-bg': theme.background.surface.elevated,
    '--home-tab-card-border': theme.border.default,
    '--home-tab-card-hover-bg': theme.background.surface.hover,
    '--home-tab-card-text': theme.foreground.text.primary,
    '--home-tab-card-meta': theme.foreground.text.secondary,
    '--home-tab-card-link': theme.border.focus,
    '--home-tab-footer-bg': theme.background.surface.inset,
    '--home-tab-footer-border': theme.border.default,
    '--home-tab-placeholder-bg': theme.background.surface.subtle,
  } as React.CSSProperties;

  return (
    <div className={`home-tab ${className}`} style={style}>
      {/* Left Sidebar */}
      <div className="home-tab__sidebar">
        <button
          className={`home-tab__sidebar-item home-tab__sidebar-item--account ${activeSidebarItem === 'my-accounts' ? 'home-tab__sidebar-item--active' : ''}`}
          onClick={() => setActiveSidebarItem('my-accounts')}
        >
          <Icon name="user" size={16} className="home-tab__sidebar-icon" />
          <span className="home-tab__sidebar-label">My accounts</span>
        </button>
        <button
          className={`home-tab__sidebar-item ${activeSidebarItem === 'project' ? 'home-tab__sidebar-item--active' : ''}`}
          onClick={() => {
            setActiveSidebarItem('project');
            setActiveSection('new-recent');
          }}
        >
          <Icon name="waveform" size={20} className="home-tab__sidebar-icon" />
          <span className="home-tab__sidebar-label">Projects</span>
        </button>
        <button
          className={`home-tab__sidebar-item ${activeSidebarItem === 'plugins' ? 'home-tab__sidebar-item--active' : ''}`}
          onClick={() => setActiveSidebarItem('plugins')}
        >
          <Icon name="plugins" size={20} className="home-tab__sidebar-icon" />
          <span className="home-tab__sidebar-label">Plugins</span>
        </button>
        <button
          className={`home-tab__sidebar-item ${activeSidebarItem === 'learn' ? 'home-tab__sidebar-item--active' : ''}`}
          onClick={() => setActiveSidebarItem('learn')}
        >
          <Icon name="book" size={20} className="home-tab__sidebar-icon" />
          <span className="home-tab__sidebar-label">Learn</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="home-tab__main">
        <div className="home-tab__content">
          {/* Header - Only show on Project page */}
          {activeSidebarItem === 'project' && (
            <>
              <div className="home-tab__header">
                <h1 className="home-tab__title">Projects</h1>
                <SearchField
                  value={searchQuery}
                  onChange={(value) => {
                    setSearchQuery(value);
                    onSearch?.(value);
                  }}
                  placeholder="Search"
                  width={200}
                />
              </div>

              {/* Tabs */}
              <div className="home-tab__tabs">
                <div className="home-tab__tabs-left">
                  <button
                    className={`home-tab__tab ${activeSection === 'new-recent' ? 'home-tab__tab--active' : ''}`}
                    onClick={() => setActiveSection('new-recent')}
                  >
                    <span>New & recent</span>
                    {activeSection === 'new-recent' && <div className="home-tab__tab-underline" />}
                  </button>
                  <button
                    className={`home-tab__tab ${activeSection === 'cloud-projects' ? 'home-tab__tab--active' : ''}`}
                    onClick={() => setActiveSection('cloud-projects')}
                  >
                    <span>Cloud projects</span>
                    {activeSection === 'cloud-projects' && <div className="home-tab__tab-underline" />}
                  </button>
                  <button
                    className={`home-tab__tab ${activeSection === 'cloud-audio' ? 'home-tab__tab--active' : ''}`}
                    onClick={() => setActiveSection('cloud-audio')}
                  >
                    <span>Cloud audio files</span>
                    {activeSection === 'cloud-audio' && <div className="home-tab__tab-underline" />}
                  </button>
                </div>
                <div className="home-tab__tabs-right">
                  {(activeSection === 'cloud-projects' || activeSection === 'cloud-audio') && (
                    <Button
                      variant="secondary"
                      size="default"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      icon={<Icon name="refresh" size={16} />}
                    >
                      Refresh
                    </Button>
                  )}
                  <button
                    className={`home-tab__icon-btn ${viewMode === 'grid' ? 'home-tab__icon-btn--active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    aria-label="Grid view"
                  >
                    <Icon name="grid-view" size={16} />
                  </button>
                  <button
                    className={`home-tab__icon-btn ${viewMode === 'list' ? 'home-tab__icon-btn--active' : ''}`}
                    onClick={() => setViewMode('list')}
                    aria-label="List view"
                  >
                    <Icon name="list-view" size={16} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Content Area */}
          {activeSidebarItem === 'project' && (
            <>
              {/* New & recent tab - show local files + cloud projects (if signed in) */}
              {activeSection === 'new-recent' && (
                <>
                  {viewMode === 'grid' ? (
                    <div className="home-tab__projects-scroll-container">
                      <div className="home-tab__projects-grid">
                        <ProjectThumbnail
                          isNewProject
                          title="New project"
                          onClick={handleCreateNewProject}
                        />
                        {storedProjects.map((project) => (
                          <ProjectThumbnail
                            key={project.id}
                            title={project.title}
                            dateText={formatDateText(project.dateModified)}
                            thumbnailUrl={project.thumbnailUrl}
                            isCloudProject={project.isCloudProject}
                            isUploading={project.isUploading}
                            isCurrent={project.id === currentProjectId}
                            onClick={() => {
                              console.log('Open project:', project.id);
                              if (onOpenProject) {
                                onOpenProject(project.id);
                              }
                            }}
                            onContextMenu={(e) => {
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                itemId: project.id,
                                isCloudItem: project.isCloudProject,
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="home-tab__projects-list">
                      <button
                        className="home-tab__list-item home-tab__list-item--new-project"
                        onClick={handleCreateNewProject}
                      >
                        <div className="home-tab__list-item-name">
                          <div className="home-tab__list-item-thumbnail">
                            <Icon name="plus" size={24} />
                          </div>
                          <div className="home-tab__list-item-title">New project</div>
                        </div>
                        <div></div>
                        <div></div>
                        <div></div>
                      </button>
                      <div className="home-tab__list-header-row">
                        <div className="home-tab__list-header">
                          <div className="home-tab__list-header-cell">Name</div>
                          <div className="home-tab__list-header-cell"></div>
                          <div className="home-tab__list-header-cell">Modified</div>
                          <div className="home-tab__list-header-cell">Size</div>
                        </div>
                        <div className="home-tab__list-header-spacer" />
                      </div>
                      <div className="home-tab__list-items">
                      {storedProjects.map((project) => (
                        <div
                          key={project.id}
                          className={`home-tab__list-item-wrapper${project.id === currentProjectId ? ' home-tab__list-item-wrapper--current' : ''}`}
                        >
                          <button
                            className="home-tab__list-item"
                            onClick={() => {
                              console.log('Open project:', project.id);
                              if (onOpenProject) {
                                onOpenProject(project.id);
                              }
                            }}
                          >
                            <div className="home-tab__list-item-name">
                              <div className="home-tab__list-item-thumbnail">
                                {project.thumbnailUrl ? (
                                  <img src={project.thumbnailUrl} alt={project.title} />
                                ) : (
                                  <AudacityLogo />
                                )}
                              </div>
                              <div className="home-tab__list-item-title">{project.title}</div>
                              {project.id === currentProjectId && (
                                <span className="home-tab__list-item-current-pill">CURRENT</span>
                              )}
                            </div>
                            {(project.isCloudProject || project.isUploading) && (
                              <div className={`home-tab__list-item-cloud-badge${project.isUploading ? ' home-tab__list-item-cloud-badge--uploading' : ''}`}>
                                <Icon name={project.isUploading ? 'cloud' : 'cloud-filled'} size={12} />
                              </div>
                            )}
                            {!project.isCloudProject && !project.isUploading && <div></div>}
                            <div className="home-tab__list-item-modified">{formatDateText(project.dateModified)}</div>
                            <div className="home-tab__list-item-size">-</div>
                          </button>
                          <button
                            className="home-tab__list-item-context-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setContextMenu({
                                x: rect.right,
                                y: rect.bottom,
                                itemId: project.id,
                                isCloudItem: project.isCloudProject,
                              });
                            }}
                            aria-label="More options"
                          >
                            <Icon name="menu" size={16} />
                          </button>
                        </div>
                      ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Cloud projects tab - show sign-in prompt if not signed in */}
              {activeSection === 'cloud-projects' && !isSignedIn && (
                <div className="home-tab__empty-state">
                  <div className="home-tab__empty-text">
                    <div className="home-tab__empty-title">You are not signed in</div>
                    <div className="home-tab__empty-description">
                      Log in or create a new account <a href="#">audio.com</a> to view cloud saved projects
                    </div>
                  </div>
                  <div className="home-tab__empty-actions">
                    <Button variant="secondary" size="default" onClick={onCreateAccount}>
                      Create account
                    </Button>
                    <Button variant="secondary" size="default" onClick={onSignIn}>
                      Sign in
                    </Button>
                  </div>
                </div>
              )}

              {/* Cloud projects tab - show projects when signed in */}
              {activeSection === 'cloud-projects' && isSignedIn && (
                <div className="home-tab__projects-scroll-container">
                  {isRefreshing ? (
                    <Spinner />
                  ) : allCloudProjects.length === 0 ? (
                    <div className="home-tab__empty-state">
                      <div className="home-tab__empty-text">
                        <div className="home-tab__empty-title">No cloud projects yet</div>
                        <div className="home-tab__empty-description">
                          Save a project to the cloud using File &rarr; Save project &rarr; Save to Cloud
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {viewMode === 'grid' ? (
                        <div className="home-tab__projects-grid">
                          {currentProjects.map((project) => (
                            <ProjectThumbnail
                              key={project.id}
                              title={project.title}
                              dateText={formatDateText(project.dateModified)}
                              thumbnailUrl={project.thumbnailUrl}
                              isCloudProject
                              isUploading={project.isUploading}
                              isCurrent={project.id === currentProjectId}
                              onClick={() => onOpenProject?.(project.id)}
                              onContextMenu={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setContextMenu({
                                  x: rect.right,
                                  y: rect.bottom,
                                  itemId: project.id,
                                  isCloudItem: true,
                                });
                              }}
                            />
                          ))}
                        </div>
                      ) : (
                    <div className="home-tab__projects-list">
                      <div className="home-tab__list-header-row">
                        <div className="home-tab__list-header">
                          <div className="home-tab__list-header-cell">Name</div>
                          <div className="home-tab__list-header-cell"></div>
                          <div className="home-tab__list-header-cell">Modified</div>
                          <div className="home-tab__list-header-cell">Size</div>
                        </div>
                        <div className="home-tab__list-header-spacer" />
                      </div>
                      <div className="home-tab__list-items">
                      {currentProjects.map((project) => (
                          <div
                            key={project.id}
                            className={`home-tab__list-item-wrapper${project.id === currentProjectId ? ' home-tab__list-item-wrapper--current' : ''}`}
                          >
                            <button
                              className="home-tab__list-item"
                              onClick={() => onOpenProject?.(project.id)}
                            >
                              <div className="home-tab__list-item-name">
                                <div className="home-tab__list-item-thumbnail">
                                  {project.thumbnailUrl ? (
                                    <img src={project.thumbnailUrl} alt={project.title} />
                                  ) : (
                                    <AudacityLogo />
                                  )}
                                </div>
                                <div className="home-tab__list-item-title">{project.title}</div>
                                {project.id === currentProjectId && (
                                  <span className="home-tab__list-item-current-pill">CURRENT</span>
                                )}
                              </div>
                              <div className="home-tab__list-item-cloud-badge">
                                <Icon name="cloud-filled" size={12} />
                              </div>
                              <div className="home-tab__list-item-modified">{formatDateText(project.dateModified)}</div>
                              <div className="home-tab__list-item-size">-</div>
                            </button>
                            <button
                              className="home-tab__list-item-context-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setContextMenu({
                                  x: rect.right,
                                  y: rect.bottom,
                                  itemId: project.id,
                                  isCloudItem: true,
                                });
                              }}
                              aria-label="More options"
                            >
                              <Icon name="menu" size={16} />
                            </button>
                          </div>
                      ))}
                      </div>
                    </div>
                  )}
                  {totalPages > 1 && (
                    <div className="home-tab__pagination-container">
                      <div className="home-tab__pagination">
                        <button
                          className="home-tab__pagination-btn"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          aria-label="Previous page"
                        >
                          <Icon name="chevron-left" size={16} />
                        </button>
                        {getPageNumbers(totalPages, currentPage).map((page, index) => {
                          if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                            return (
                              <span key={page} className="home-tab__pagination-ellipsis">
                                …
                              </span>
                            );
                          }
                          return (
                            <button
                              key={page}
                              className={`home-tab__pagination-number ${currentPage === page ? 'home-tab__pagination-number--active' : ''}`}
                              onClick={() => setCurrentPage(page)}
                              aria-label={`Page ${page}`}
                              aria-current={currentPage === page ? 'page' : undefined}
                            >
                              {page}
                            </button>
                          );
                        })}
                        <button
                          className="home-tab__pagination-btn"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          aria-label="Next page"
                        >
                          <Icon name="chevron-right" size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </div>
              )}

              {/* Cloud audio files tab - show sign-in prompt if not signed in */}
              {activeSection === 'cloud-audio' && !isSignedIn && (
                <div className="home-tab__empty-state">
                  <div className="home-tab__empty-text">
                    <div className="home-tab__empty-title">You are not signed in</div>
                    <div className="home-tab__empty-description">
                      Log in or create a new account <a href="#">audio.com</a> to view cloud audio files
                    </div>
                  </div>
                  <div className="home-tab__empty-actions">
                    <Button variant="secondary" size="default" onClick={onCreateAccount}>
                      Create account
                    </Button>
                    <Button variant="secondary" size="default" onClick={onSignIn}>
                      Sign in
                    </Button>
                  </div>
                </div>
              )}

              {/* Cloud audio files tab - show audio files when signed in */}
              {activeSection === 'cloud-audio' && isSignedIn && (
                <div className="home-tab__projects-scroll-container">
                  {isRefreshing ? (
                    <Spinner />
                  ) : (
                    <>
                      {viewMode === 'grid' ? (
                        <div className="home-tab__projects-grid">
                          {currentAudioFiles.map((audioFile, index) => {
                            return (
                              <AudioFileThumbnail
                                key={audioFile.id}
                                title={audioFile.title}
                                dateText={audioFile.dateText}
                                duration={audioFile.duration}
                                isCloudFile
                                onContextMenu={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setContextMenu({
                                    x: rect.right,
                                    y: rect.bottom,
                                    itemId: audioFile.id,
                                    isCloudItem: true,
                                    itemType: 'audio',
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      ) : (
                    <div className="home-tab__projects-list">
                      <div className="home-tab__list-header-row home-tab__list-header-row--audio">
                        <div className="home-tab__list-header home-tab__list-header--audio">
                          <div className="home-tab__list-header-cell">Name</div>
                          <div className="home-tab__list-header-cell"></div>
                          <div className="home-tab__list-header-cell">Modified</div>
                          <div className="home-tab__list-header-cell">Duration</div>
                          <div className="home-tab__list-header-cell">Size</div>
                          <div className="home-tab__list-header-cell"></div>
                        </div>
                      </div>
                      <div className="home-tab__list-items">
                      {currentAudioFiles.map((audioFile, index) => {
                        return (
                          <div
                            key={audioFile.id}
                            className="home-tab__list-item-wrapper home-tab__list-item-wrapper--audio"
                          >
                            <button
                              className="home-tab__list-item home-tab__list-item--audio"
                              onClick={() => {
                                console.log('Open audio file:', audioFile.id);
                              }}
                            >
                              <div className="home-tab__list-item-audio-name">
                                <div className="home-tab__list-item-title">{audioFile.title}</div>
                              </div>
                              <WaveformPreview
                                samples={audioWaveforms[index] ?? []}
                                color={theme.audio.clip.blue.waveform}
                                width="100%"
                                height={40}
                                className="home-tab__list-item-waveform"
                              />
                              <div className="home-tab__list-item-modified">{audioFile.dateText}</div>
                              <div className="home-tab__list-item-duration-col">{audioFile.duration}</div>
                              <div className="home-tab__list-item-size">{audioFile.size}</div>
                            </button>
                            <button
                              className="home-tab__list-item-context-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setContextMenu({
                                  x: rect.right,
                                  y: rect.bottom,
                                  itemId: audioFile.id,
                                  isCloudItem: true,
                                  itemType: 'audio',
                                });
                              }}
                              aria-label="More options"
                            >
                              <Icon name="menu" size={16} />
                            </button>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                  )}
                  {audioTotalPages > 1 && (
                    <div className="home-tab__pagination-container">
                      <div className="home-tab__pagination">
                        <button
                          className="home-tab__pagination-btn"
                          onClick={() => setAudioPage(p => Math.max(1, p - 1))}
                          disabled={audioPage === 1}
                          aria-label="Previous page"
                        >
                          <Icon name="chevron-left" size={16} />
                        </button>
                        {getPageNumbers(audioTotalPages, audioPage).map((page, index) => {
                          if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                            return (
                              <span key={page} className="home-tab__pagination-ellipsis">
                                …
                              </span>
                            );
                          }
                          return (
                            <button
                              key={page}
                              className={`home-tab__pagination-number ${audioPage === page ? 'home-tab__pagination-number--active' : ''}`}
                              onClick={() => setAudioPage(page)}
                              aria-label={`Page ${page}`}
                              aria-current={audioPage === page ? 'page' : undefined}
                            >
                              {page}
                            </button>
                          );
                        })}
                        <button
                          className="home-tab__pagination-btn"
                          onClick={() => setAudioPage(p => Math.min(audioTotalPages, p + 1))}
                          disabled={audioPage === audioTotalPages}
                          aria-label="Next page"
                        >
                          <Icon name="chevron-right" size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </div>
              )}

            </>
          )}

          {/* Plugins page */}
          {activeSidebarItem === 'plugins' && (
            <>
              {/* Header */}
              <div className="home-tab__header">
                <h1 className="home-tab__title">Plugins</h1>
                <div className="home-tab__header-controls">
                  <SearchField
                    value={pluginsSearchQuery}
                    onChange={setPluginsSearchQuery}
                    placeholder="Search"
                    width={200}
                  />
                  <Dropdown
                    value={pluginsCategory}
                    onChange={setPluginsCategory}
                    options={[
                      { value: 'all', label: 'All Categories' },
                      { value: 'generators', label: 'Generators' },
                      { value: 'effects', label: 'Effects' },
                      { value: 'analyzers', label: 'Analyzers' },
                    ]}
                  />
                </div>
              </div>

              <div className="home-tab__plugins-page">
                <div className="home-tab__plugins-content">
                  <div ref={pluginsScrollRef} className="home-tab__plugins-scroll">
                    {pluginsLoading ? (
                      <div className="home-tab__plugins-loading">
                        <Spinner />
                        <p className="home-tab__plugins-loading-text">Loading plugins...</p>
                      </div>
                    ) : (
                      <div className="home-tab__plugins-grid">
                        {filteredPlugins.map((plugin) => (
                          <PluginCard
                            key={plugin.id}
                            name={plugin.name}
                            description={plugin.description}
                            imageUrl={plugin.imageUrl}
                            onActionClick={() => {
                              console.log(`Install plugin: ${plugin.name}`);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <CustomScrollbar
                    contentRef={pluginsScrollRef}
                    orientation="vertical"
                    width={16}
                    backgroundColor="#ebedf0"
                    borderColor="#d4d5d9"
                  />
                </div>
              </div>
            </>
          )}

          {/* My accounts page */}
          {activeSidebarItem === 'my-accounts' && (
            <>
              {/* Header */}
              <div className="home-tab__header">
                <h1 className="home-tab__title">Accounts</h1>
              </div>
              <div className="home-tab__accounts-page">
                <div className="home-tab__accounts-list">
                  {/* Extra account cards (e.g. MuseHub) rendered before the
                      built-in Audio.com card so additional services don't
                      get buried at the bottom of the list. */}
                  {extraAccountsSections}

                  {/* Audio.com Service */}
                  <div className="home-tab__accounts-section">
                    <h2 className="home-tab__accounts-section-title">Audio.com</h2>
                    <div className="home-tab__accounts-card">
                      <div className="home-tab__accounts-avatar">
                        {isSignedIn && userAvatarUrl ? (
                          <img src={userAvatarUrl} alt={userName || 'User'} className="home-tab__accounts-avatar-image" />
                        ) : (
                          <Icon name="user" size={48} />
                        )}
                      </div>
                      <div className="home-tab__accounts-content">
                        <div className="home-tab__accounts-text">
                          <h3 className="home-tab__accounts-title">{isSignedIn ? (userName || 'Username') : 'Not signed in'}</h3>
                          <p className="home-tab__accounts-subtitle">Service name / URL</p>
                        </div>
                        <div className="home-tab__accounts-actions">
                          {isSignedIn ? (
                            <>
                              <Button variant="primary" size="default" onClick={onManageAccount ?? (() => window.open('https://audio.com', '_blank'))}>
                                Manage account
                              </Button>
                              <Button variant="secondary" size="default" onClick={onSignOut}>
                                Sign out
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="primary" size="default" onClick={onSignIn}>
                                Sign in
                              </Button>
                              <Button variant="primary" size="default" onClick={onCreateAccount}>
                                Create account
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Learn page */}
          {activeSidebarItem === 'learn' && (
            <div className="home-tab__empty-state">
              <div className="home-tab__empty-text">
                <div className="home-tab__empty-title">Learn</div>
                <div className="home-tab__empty-description">
                  Tutorials and learning resources
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Actions - Only shown on Project page */}
        {activeSidebarItem === 'project' && (
          <div className="home-tab__footer">
            <div className="home-tab__footer-right">
              <Button variant="secondary" size="default" onClick={handleCreateNewProject}>
                New
              </Button>
              <Button variant="secondary" size="default" onClick={onOpenOther}>
                Open other...
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={true}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        >
          <ContextMenuItem
            label="Open"
            onClick={() => {
              console.log('Open:', contextMenu.itemId);
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
          {contextMenu.isCloudItem && (
            <ContextMenuItem
              label="View in audio.com"
              onClick={() => {
                onViewProjectOnCloud?.(contextMenu.itemId);
                setContextMenu(null);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
          <ContextMenuItem
            label="Rename"
            onClick={() => {
              console.log('Rename:', contextMenu.itemId);
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
          <ContextMenuItem
            label="Duplicate"
            onClick={() => {
              console.log('Duplicate:', contextMenu.itemId);
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
          {contextMenu.isCloudItem && (
            <ContextMenuItem
              label="Download"
              onClick={() => {
                console.log('Download:', contextMenu.itemId);
                setContextMenu(null);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
          <ContextMenuItem
            label="Delete"
            onClick={() => {
              if (contextMenu.itemType === 'audio') {
                onDeleteAudioFile?.(contextMenu.itemId);
              } else {
                handleDeleteProject(contextMenu.itemId);
              }
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
        </ContextMenu>
      )}
    </div>
  );
}
