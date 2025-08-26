module.exports = {
  module: {
    rules: [
      {
        test: /\.js$/,
        enforce: 'pre',
        use: ['source-map-loader'],
        exclude: /html5-qrcode/,
      },
    ],
  },
  ignoreWarnings: [/Failed to parse source map/],
};
