// postcss.config.cjs
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},   // <-- use this (NOT "tailwindcss": {})
    autoprefixer: {},
  },
};
