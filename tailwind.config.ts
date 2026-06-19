import type { Config } from 'tailwindcss';
import iglooPreset from 'igloo-ui/tailwind.preset';

const config: Config = {
  presets: [iglooPreset as Config],
  content: ['./src/**/*.{ts,tsx}', '../igloo-ui/src/**/*.{ts,tsx}'],
};

export default config;
