import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './Spinner';
import { ThemeProvider } from '../ThemeProvider';
import { lightTheme, darkTheme } from '@audacity-ui/tokens';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: { type: 'number', min: 16, max: 128, step: 8 },
      description: 'Size of the spinner in pixels',
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={lightTheme}>
        <div style={{ padding: '40px' }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default spinner with 48px size
 */
export const Default: Story = {
  args: {
    size: 48,
  },
};

/**
 * Small spinner (32px)
 */
export const Small: Story = {
  args: {
    size: 32,
  },
};

/**
 * Large spinner (64px)
 */
export const Large: Story = {
  args: {
    size: 64,
  },
};

/**
 * Extra large spinner (96px)
 */
export const ExtraLarge: Story = {
  args: {
    size: 96,
  },
};

/**
 * Spinner in dark theme
 */
export const DarkTheme: Story = {
  args: {
    size: 48,
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={darkTheme}>
        <div style={{ padding: '40px', backgroundColor: '#14151a' }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};

/**
 * Multiple spinners showing different sizes
 */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <Spinner size={24} />
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#6c6c70' }}>24px</p>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Spinner size={32} />
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#6c6c70' }}>32px</p>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Spinner size={48} />
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#6c6c70' }}>48px</p>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Spinner size={64} />
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#6c6c70' }}>64px</p>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Spinner size={96} />
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#6c6c70' }}>96px</p>
      </div>
    </div>
  ),
};

/**
 * Spinner in a loading context
 */
export const InContext: Story = {
  render: () => (
    <div
      style={{
        width: '400px',
        height: '300px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ebedf0',
        borderRadius: '8px',
        gap: '16px',
      }}
    >
      <Spinner size={48} />
      <p style={{ fontSize: '14px', color: '#6c6c70' }}>Loading plugins...</p>
    </div>
  ),
};
