/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0E1220',
        panel: '#151A2D',
        raised: '#1C2238',
        line: '#2A3351',
        text: '#E7E9F3',
        mute: '#9099B6',
        faint: '#5F678A',
        signal: '#8FA2FF',
        danger: '#FF7A7A',
        ok: '#5FD08A',
      },
      fontFamily: { sans: ['Vazirmatn', 'Segoe UI', 'Tahoma', 'sans-serif'], mono: ['ui-monospace', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
