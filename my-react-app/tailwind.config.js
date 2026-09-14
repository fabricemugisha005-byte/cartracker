export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb', // Trustworthy Blue
        emergency: '#ef4444', // Red
        important: '#f97316', // Orange
        normal: '#eab308', // Yellow
        solved: '#22c55e', // Green
      }
    }
  },
  plugins: [],
}