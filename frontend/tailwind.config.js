/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"DM Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        marca: { 50: '#EEF6F5', 100: '#D6EBE9', 200: '#BFDCDA', 600: '#13807F', 700: '#0F6E6E', 800: '#0A4F4F' },
      },
    },
  },
  plugins: [],
};
