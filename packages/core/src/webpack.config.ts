import path from 'path';
import webpack from 'webpack';
import { smart as merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import { getSsrConfig } from './helpers/core';
import {
  hasUserBabelrc,
  getBabelrc,
  getBabelRule,
} from './helpers/babel';

const cwd = process.cwd();
const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';

const prodConfig: webpack.Configuration = {
  performance: {
    hints: 'warning',
  },
  output: {
    pathinfo: false,
  },
  optimization: {
    nodeEnv: 'production',
    namedModules: false,
    namedChunks: false,
    flagIncludedChunks: true,
    occurrenceOrder: true,
    sideEffects: true,
    usedExports: true,
    concatenateModules: true,
    splitChunks: {
      minSize: 30000,
      maxAsyncRequests: 5,
      maxInitialRequests: 3,
    },
    minimize: true,
    minimizer: [
      new TerserPlugin(),
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    new webpack.optimize.ModuleConcatenationPlugin(),
  ],
};

export const configureWebpack = (entry: webpack.Entry): webpack.Configuration => {
  const ssrConfig = getSsrConfig();

  if (env === 'development') {
    if (hasUserBabelrc()) {
      console.log(`[ info ] custom babelrc in: ${getBabelrc()}`);
    }
  }

  let config: webpack.Configuration = {
    mode: 'development',
    context: path.join(cwd, 'react-ssr-src'),
    entry,
    output: {
      path: path.join(cwd, ssrConfig.distDir),
      filename: '[name].js',
      publicPath: '/',
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    module: {
      rules: [
        getBabelRule(),
      ],
    },
  };

  if (env === 'production') {
    config = merge(config, prodConfig);
  }

  if (ssrConfig.webpack) {
    if (typeof ssrConfig.webpack === 'function') {
      config = ssrConfig.webpack(config, env);
    } else {
      console.warn('[ warn ] ssr.config.js#webpack must be a function');
    }
  }

  return config;
};