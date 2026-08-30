import { defineConfig } from '@tarojs/cli'
import path from 'path'

const isH5 = process.env.TARO_ENV === 'h5'
const outputRoot = isH5 ? 'dist-h5' : 'dist'
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] || ''
const isUserPagesRepository = repositoryName.endsWith('.github.io')
const h5PublicPath = process.env.GITHUB_ACTIONS === 'true' && repositoryName && !isUserPagesRepository
  ? `/${repositoryName}/`
  : '/'

export default defineConfig({
  projectName: 'personal-kitchen',
  date: '2026-05-16',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot,
  alias: {
    '@': path.resolve(__dirname, '..', 'src')
  },
  defineConstants: {
    'process.env.TARO_APP_IMPORT_API_BASE': JSON.stringify(process.env.TARO_APP_IMPORT_API_BASE || '')
  },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: {
      enable: false
    }
  },
  plugins: ['@tarojs/plugin-framework-react', '@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  copy: {
    patterns: [
      {
        from: 'sitemap.json',
        to: `${outputRoot}/sitemap.json`
      }
    ],
    options: {}
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]'
        }
      }
    }
  },
  h5: {
    publicPath: h5PublicPath,
    staticDirectory: 'static',
    router: { mode: 'hash' }
  }
})
