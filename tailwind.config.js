/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        surface: '#0b1222',
        panel: '#0f172a',
        accent: '#06b6d4'
      },
      boxShadow: {
        card: '0 12px 40px rgba(0,0,0,0.35)'
      }
    }
  },
  plugins: []
}
