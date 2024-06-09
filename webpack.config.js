const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const ENTRY_PATH = path.resolve(__dirname, 'src/index');
const BUILD_PATH = path.resolve(__dirname, 'build');


module.exports = (env, argv) => {
  const config = {
    entry: {
      main: [ENTRY_PATH],
    },
    output: {
      path: BUILD_PATH,
      filename: '[name].[contenthash].js',
      assetModuleFilename: 'assets/[name][ext]',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.s[ac]ss$/,
          use: [ // fallback to style-loader in development
            argv.mode !== 'production'
              ? 'style-loader'
              : MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
        },
        { 
          test: /\.(jpg|jpeg|png|svg|ico|webp|gif)$/,
          type: 'asset/resource'
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: 'index.html',
        template: path.resolve(__dirname, 'src/index.html'),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].[contenthash].css',
      }),
    ],
    devServer: {
      static: BUILD_PATH,
      hot: true,
      liveReload: true,
      watchFiles: [path.join(__dirname, 'src/**/*')],
      historyApiFallback: true
    },
    cache: false,
  };
  if (argv.mode === 'development') {
    config.devtool = 'inline-source-map';
  }

  return config;
};