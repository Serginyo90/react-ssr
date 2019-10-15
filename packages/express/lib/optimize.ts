import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import net from 'net';
import http from 'http';
import express from 'express';
import hasha from 'hasha';
import webpack from 'webpack';
import configure from './webpack.config';
import Config from './config';
import {
  getEngine,
  gracefullyShutDown,
} from './utils';

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const cwd = process.cwd();
const ext = '.' + getEngine();
const codec = require('json-url')('lzw');

const getPages = (dir: string): string[] => {
  const pages: string[] = [];
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const p = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      pages.push(...(getPages(p)));
    } else {
      pages.push(p);
    }
  }
  return pages;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitUntilCompleted = async (mfs: any, filename: string, forceWrite?: boolean) => {
  const existsInMFS = mfs.existsSync(filename);
  let existsInFS = fse.existsSync(filename);
  if (forceWrite && existsInMFS) {
    console.log('force output: ' + filename);


    fse.outputFileSync(filename, mfs.readFileSync(filename).toString());
    existsInFS = fse.existsSync(filename);
  }
  if (existsInMFS && existsInFS) {
    return;
  }
  if (existsInMFS) {
    fse.outputFileSync(filename, mfs.readFileSync(filename).toString());
  }
  await sleep(50);
  waitUntilCompleted(mfs, filename);
}

const { ufs } = require('unionfs');
const MemoryFileSystem = require('memory-fs');
const mfs = new MemoryFileSystem;
ufs.use(mfs).use(fs);
mfs.mkdirpSync(path.join(cwd, 'react-ssr-src'));

export default async (app: express.Application, server: http.Server, config: Config): Promise<void> => {
  await fse.remove(config.cacheDir);

  console.log('[ info ] removed all caches');
  console.log('[ info ] optimizing for the performance...');

  const entry: webpack.Entry = {};
  const pages = getPages(path.join(cwd, config.viewsDir));

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const hash = hasha(env + page, { algorithm: 'md5' });
    mfs.mkdirpSync(path.join(cwd, `react-ssr-src/${hash}`));
    let entryFile = fse.readFileSync(path.join(__dirname, '../entry.jsx')).toString();
    entryFile = entryFile.replace('\'__REACT_SSR_DEVELOPMENT__\'', env === 'development' ? 'true' : 'false');
    mfs.writeFileSync(path.join(cwd, `react-ssr-src/${hash}/entry${ext}`), entryFile);
    mfs.writeFileSync(path.join(cwd, `react-ssr-src/${hash}/page${ext}`), fse.readFileSync(page));
    entry[hash] = env === 'production' ? `./react-ssr-src/${hash}/entry${ext}` : [
      // 'webpack/hot/dev-server',
      `webpack-hot-middleware/client?reload=true`,
      `./react-ssr-src/${hash}/entry${ext}`
    ];
  }

  const webpackConfig: webpack.Configuration = configure(entry, config.cacheDir);
  const compiler: webpack.Compiler = webpack(webpackConfig);
  compiler.inputFileSystem = ufs;
  compiler.outputFileSystem = mfs;
  compiler.run((err: Error) => {
    err && console.error(err.stack || err);
  });

  if (env === 'production') {
    // compiler.run((err: Error) => {
    //   err && console.error(err.stack || err);
    // });
  } else {
    // app.use(require('webpack-dev-middleware')(compiler, {
    //   hot: true,
    //   serverSideRender: true,
    //   writeToDisk: true,
    // }));
    app.use(require('webpack-hot-middleware')(compiler));

    // app.get('/_react-ssr/views/*.hot-update.json', (req, res) => {
    //   const jsonName = req.originalUrl.replace('/_react-ssr/views/', '');
    //   const jsonPath = path.join(cwd, config.cacheDir, env, jsonName);

    //   console.log(jsonPath);

    //   const json = mfs.readFileSync(jsonPath).toString();

    //   // const jsonPath = path.join(cwd, config.cacheDir, env, 'hot/hot-update.json');
    //   // const json = mfs.readFileSync(jsonPath).toString();

    //   console.log(json);

    //   res.json(json);
    // });
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const hash = hasha(env + page, { algorithm: 'md5' });
    const filename = path.join(cwd, config.cacheDir, env, `${hash}.js`);

    await waitUntilCompleted(mfs, filename);

    const [, ...rest] = page.replace(cwd, '').split(path.sep);
    const id = rest.join('/');
    const route = '/_react-ssr/' + id.replace(ext, '.js');

    console.log(`  [ ok ] optimized "${id}"`);

    app.get(route, async (req, res) => {
      const props = await codec.decompress(req.query.props);
      if (env === 'development') {
        console.log('[ info ] props below is rendered from server side');
        console.log(props);
      }

      const script = fse.readFileSync(filename).toString()
                      .replace(
                        '__REACT_SSR__',
                        JSON.stringify(props).replace(/"/g, '\\"'),
                      );

      res.type('.js');
      res.send(script);
    });
  }

  if (env === 'development') {
    const escaperegexp = require('lodash.escaperegexp');
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(cwd, {
      ignored: [
        /node_modules/,
        new RegExp(escaperegexp(config.cacheDir)),
      ],
    });

    const closeWatching = () => {
      watcher.close();
    };
    process.on('SIGINT', closeWatching);
    process.on('SIGTERM', closeWatching);
    process.on('exit', closeWatching);

    watcher.on('change', async (p: string) => {
      // remove file cache by operating system
      await fse.remove(path.join(cwd, config.cacheDir, env));

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const hash = hasha(env + page, { algorithm: 'md5' });
        // mfs.mkdirpSync(path.join(cwd, `react-ssr-src/${hash}`));
        // let entryFile = fse.readFileSync(path.join(__dirname, '../entry.jsx')).toString();
        // entryFile = entryFile.replace('\'__REACT_SSR_DEVELOPMENT__\'', 'true');
        // mfs.writeFileSync(path.join(cwd, `react-ssr-src/${hash}/entry${ext}`), entryFile);
        mfs.writeFileSync(path.join(cwd, `react-ssr-src/${hash}/page${ext}`), fse.readFileSync(page));
        entry[hash] = [
          // 'webpack/hot/dev-server',
          `webpack-hot-middleware/client?reload=true`,
          `./react-ssr-src/${hash}/entry${ext}`
        ];
      }

      const webpackConfig: webpack.Configuration = configure(entry, config.cacheDir);
      const compiler: webpack.Compiler = webpack(webpackConfig);
      compiler.inputFileSystem = ufs;
      compiler.outputFileSystem = mfs;
      compiler.run((err: Error) => {
        err && console.error(err.stack || err);
      });

      // // overwrite memory fs
      // for (let i = 0; i < pages.length; i++) {
      //   const page = pages[i];
      //   const hash = hasha(env + page, { algorithm: 'md5' });
      //   // mfs.unlinkSync(path.join(cwd, `react-ssr-src/${hash}/page${ext}`));
      //   mfs.writeFileSync(path.join(cwd, `react-ssr-src/${hash}/page${ext}`), fse.readFileSync(page));
      // }

      // compiler.run((err: Error) => {
      //   err && console.error(err.stack || err);
      // });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const hash = hasha(env + page, { algorithm: 'md5' });
        const filename = path.join(cwd, config.cacheDir, env, `${hash}.js`);
        await waitUntilCompleted(mfs, filename, true);
      }

      console.log('[ info ] recompiled all bundles');
    });

    console.log('[ info ] enabled hot reloading');
  }

  gracefullyShutDown(() => {
    console.log('[ info ] gracefully shutting down. Please wait...');

    process.on('SIGINT', () => {
      process.exit(0);
    });

    const address = server.address() as net.AddressInfo;
    return address.port;
  });
};
