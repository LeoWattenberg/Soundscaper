import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { PluginCard } from '../PluginCard';
import { CustomScrollbar } from '../CustomScrollbar';
import { Spinner } from '../Spinner';
import './PluginBrowserDialog.css';

export type PluginCategory =
  | 'all'
  | 'voice-podcasting'
  | 'mixing-mastering'
  | 'reverb-delay'
  | 'de-esser'
  | 'guitars-amp-simulation'
  | 'sound-design-effects'
  | 'tone-dynamics'
  | 'tape-texture'
  | 'beats-percussion';

export interface BrowserPlugin {
  id: string;
  name: string;
  description: string;
  categories: PluginCategory[];
  imageUrl?: string;
  isFree?: boolean;
  requiresVersion?: string;
}

export interface PluginBrowserDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Close handler
   */
  onClose: () => void;
  /**
   * Current category
   */
  currentCategory?: PluginCategory;
  /**
   * Category change handler
   */
  onCategoryChange?: (category: PluginCategory) => void;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Additional CSS classes
   */
  className?: string;
}

const categories: { id: PluginCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'voice-podcasting', label: 'Voice & Podcasting' },
  { id: 'mixing-mastering', label: 'Mixing & Mastering' },
  { id: 'reverb-delay', label: 'Reverb & Delay' },
  { id: 'de-esser', label: 'De-Esser' },
  { id: 'guitars-amp-simulation', label: 'Guitars & Amp' },
  { id: 'sound-design-effects', label: 'Sound Design' },
  { id: 'tone-dynamics', label: 'Tone & Dynamics' },
  { id: 'tape-texture', label: 'Tape & Texture' },
  { id: 'beats-percussion', label: 'Beats & Percussion' },
];

// Mock plugin data - all plugins with their categories
const allPlugins: BrowserPlugin[] = [
  // Voice & Podcasting
  {
    id: 'graillon-3',
    name: 'Graillon 3',
    description: 'Real-time vocal tuner',
    categories: ['voice-podcasting'],
    imageUrl: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=300&h=300&fit=crop',
  },
  {
    id: 'inner-pitch-2',
    name: 'Inner Pitch 2',
    description: 'Creative pitch-shifting plugin',
    categories: ['voice-podcasting', 'sound-design-effects'],
    imageUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=300&h=300&fit=crop',
  },
  {
    id: 'voice-enhance',
    name: 'Voice Enhance Pro',
    description: 'Professional voice enhancement',
    categories: ['voice-podcasting'],
    imageUrl: 'https://images.unsplash.com/photo-1589903308904-1010c2294adc?w=300&h=300&fit=crop',
  },
  // Mixing & Mastering
  {
    id: 'musefx',
    name: 'MuseFX',
    description: 'Essential mix effects collection',
    categories: ['mixing-mastering'],
    imageUrl: 'https://images.unsplash.com/photo-1598653222000-6b7b7a552625?w=300&h=300&fit=crop',
  },
  {
    id: 'shape-it',
    name: 'Shape It',
    description: 'Parametric 10 band EQ',
    categories: ['mixing-mastering', 'tone-dynamics'],
    imageUrl: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=300&h=300&fit=crop',
  },
  {
    id: 'place-it',
    name: 'Place It',
    description: '10 band parametric EQ',
    categories: ['mixing-mastering', 'sound-design-effects'],
    imageUrl: 'https://images.unsplash.com/photo-1614149162883-504ce0ecad82?w=300&h=300&fit=crop',
  },
  // Reverb & Delay
  {
    id: 'borealis-le',
    name: 'BOREALIS-LE',
    description: 'FREE Light Edition of BOREALIS',
    categories: ['reverb-delay', 'sound-design-effects'],
    imageUrl: 'https://images.unsplash.com/photo-1551715398-f3f6ddbe1f00?w=300&h=300&fit=crop',
  },
  {
    id: 'space-echo',
    name: 'Space Echo',
    description: 'Vintage delay and reverb',
    categories: ['reverb-delay'],
    imageUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300&h=300&fit=crop',
  },
  // De-Esser
  {
    id: 'smooth-vocal',
    name: 'Smooth Vocal',
    description: 'Advanced de-essing tool',
    categories: ['de-esser', 'voice-podcasting'],
    imageUrl: 'https://images.unsplash.com/photo-1590845947670-c009801ffa74?w=300&h=300&fit=crop',
  },
  {
    id: 'clarity-plus',
    name: 'Clarity Plus',
    description: 'Intelligent sibilance control',
    categories: ['de-esser'],
    imageUrl: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=300&h=300&fit=crop',
  },
  // Guitars & Amp
  {
    id: 'amp-studio',
    name: 'Amp Studio',
    description: 'Guitar amplifier simulation',
    categories: ['guitars-amp-simulation'],
    imageUrl: 'https://images.unsplash.com/photo-1556449895-a33c9dba33dd?w=300&h=300&fit=crop',
  },
  {
    id: 'pedal-board',
    name: 'Pedal Board',
    description: 'Virtual guitar effects pedals',
    categories: ['guitars-amp-simulation'],
    imageUrl: 'https://images.unsplash.com/photo-1606682116200-ab4f67753489?w=300&h=300&fit=crop',
  },
  // Sound Design
  {
    id: 'neutone-fx',
    name: 'Neutone FX',
    description: 'AI powered sound effects',
    categories: ['sound-design-effects'],
    imageUrl: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=300&h=300&fit=crop',
  },
  {
    id: 'spectrum-fx',
    name: 'Spectrum FX',
    description: 'Spectral sound design tools',
    categories: ['sound-design-effects'],
    imageUrl: 'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=300&h=300&fit=crop',
  },
  // Tone & Dynamics
  {
    id: 'dynamic-master',
    name: 'Dynamic Master',
    description: 'Professional dynamics control',
    categories: ['tone-dynamics', 'mixing-mastering'],
    imageUrl: 'https://images.unsplash.com/photo-1598887142487-3c854d7c3de8?w=300&h=300&fit=crop',
  },
  {
    id: 'tone-shaper',
    name: 'Tone Shaper',
    description: 'Advanced tone sculpting',
    categories: ['tone-dynamics'],
    imageUrl: 'https://images.unsplash.com/photo-1563330232-57114bb0823c?w=300&h=300&fit=crop',
  },
  // Tape & Texture
  {
    id: 'vintage-tape',
    name: 'Vintage Tape',
    description: 'Authentic tape saturation',
    categories: ['tape-texture'],
    imageUrl: 'https://images.unsplash.com/photo-1603473219299-1c2cb6b09c38?w=300&h=300&fit=crop',
  },
  {
    id: 'analog-warmth',
    name: 'Analog Warmth',
    description: 'Classic analog character',
    categories: ['tape-texture'],
    imageUrl: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=300&h=300&fit=crop',
  },
  // Beats & Percussion
  {
    id: 'drum-enhancer',
    name: 'Drum Enhancer',
    description: 'Powerful drum processing',
    categories: ['beats-percussion'],
    imageUrl: 'https://images.unsplash.com/photo-1571327073757-71d13c24de30?w=300&h=300&fit=crop',
  },
  {
    id: 'beat-forge',
    name: 'Beat Forge',
    description: 'Percussion design toolkit',
    categories: ['beats-percussion'],
    imageUrl: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=300&h=300&fit=crop',
  },
];

export const PluginBrowserDialog: React.FC<PluginBrowserDialogProps> = ({
  isOpen,
  onClose,
  currentCategory = 'all',
  onCategoryChange,
  os = 'macos',
  className = '',
}) => {
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory>(currentCategory);
  const [plugins, setPlugins] = useState<BrowserPlugin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleCategoryChange = (category: PluginCategory) => {
    setSelectedCategory(category);
    onCategoryChange?.(category);
  };

  // Simulate API call to fetch plugins
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    setPlugins([]);

    // Simulate API delay (3 seconds)
    const timer = setTimeout(() => {
      // In a real implementation, this would fetch from MuseHub API
      // Simulate some plugins not having images (every 4th plugin has no image)
      const pluginsWithMixedImages = allPlugins.map((plugin, index) => ({
        ...plugin,
        imageUrl: index % 4 === 0 ? undefined : plugin.imageUrl,
      }));
      setPlugins(pluginsWithMixedImages);
      setIsLoading(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Filter plugins based on selected category
  const filteredPlugins = useMemo(() => {
    if (selectedCategory === 'all') {
      return plugins;
    }
    return plugins.filter((plugin) => plugin.categories.includes(selectedCategory));
  }, [selectedCategory, plugins]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Get Effects"
      os={os}
      className={`plugin-browser-dialog ${className}`}
      width="880px"
      maximizable={true}
      closeOnClickOutside={false}
    >
      <div className="plugin-browser-dialog__container">
        {/* Sidebar Navigation */}
        <div className="plugin-browser-dialog__sidebar">
          <nav className="plugin-browser-dialog__nav">
            {categories.map((category) => (
              <button
                key={category.id}
                className={`plugin-browser-dialog__nav-item ${
                  selectedCategory === category.id ? 'plugin-browser-dialog__nav-item--active' : ''
                }`}
                onClick={() => handleCategoryChange(category.id)}
              >
                {category.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="plugin-browser-dialog__body">
          <div ref={scrollContainerRef} className="plugin-browser-dialog__scroll-container">
            {isLoading ? (
              <div className="plugin-browser-dialog__loading">
                <Spinner size={48} />
                <p className="plugin-browser-dialog__loading-text">Loading effects...</p>
              </div>
            ) : (
              <div className="plugin-browser-dialog__grid">
                {filteredPlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    name={plugin.name}
                    description={plugin.description}
                    imageUrl={plugin.imageUrl}
                    requiresVersion={plugin.requiresVersion}
                    onActionClick={() => {
                      console.log(`Get plugin: ${plugin.name}`);
                      // In real implementation, would open MuseHub or external link
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <CustomScrollbar
            contentRef={scrollContainerRef}
            orientation="vertical"
            width={16}
            backgroundColor="#ebedf0"
            borderColor="#d4d5d9"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="plugin-browser-dialog__footer">
        <div className="plugin-browser-dialog__footer-left">
          <Button
            variant="secondary"
            onClick={() => {
              console.log('Become a partner clicked');
              // In real implementation, would open external link or partner page
            }}
          >
            Become a Partner
          </Button>
        </div>
        <div className="plugin-browser-dialog__footer-right">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default PluginBrowserDialog;
