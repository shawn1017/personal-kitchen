import Taro from '@tarojs/taro'

export async function persistImage(path: string): Promise<string> {
  if (!path) return ''
  try {
    let tempFilePath = path
    if (/^https?:\/\//i.test(path)) {
      const downloaded = await Taro.downloadFile({ url: path })
      if (downloaded.statusCode !== 200) throw new Error(`download status ${downloaded.statusCode}`)
      tempFilePath = downloaded.tempFilePath
    }
    if (tempFilePath.includes('/store/')) return tempFilePath
    const saved = await Taro.saveFile({ tempFilePath })
    if ('savedFilePath' in saved) return saved.savedFilePath
    throw new Error('saveFile failed')
  } catch (error) {
    console.warn('[image] persist failed', error)
    return path
  }
}

export async function chooseAndPersistImage(): Promise<string> {
  const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
  return persistImage(result.tempFiles[0]?.tempFilePath || '')
}
