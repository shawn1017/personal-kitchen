import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request } from 'express'
import { resolveApiBase } from '../src/server.js'

function mockRequest(options: { host?: string; protocol?: string; forwardedHost?: string; forwardedProto?: string } = {}): Request {
  const host = options.host || '127.0.0.1:3210'
  return {
    protocol: options.protocol || 'http',
    headers: {
      'x-forwarded-host': options.forwardedHost,
      'x-forwarded-proto': options.forwardedProto
    },
    get(name: string) {
      return name.toLowerCase() === 'host' ? host : undefined
    }
  } as unknown as Request
}

test('Vercel 系统 URL 优先于外层代理转发头', () => {
  const previousPublicOrigin = process.env.IMPORT_PUBLIC_ORIGIN
  const previousVercelUrl = process.env.VERCEL_URL
  delete process.env.IMPORT_PUBLIC_ORIGIN
  process.env.VERCEL_URL = 'personal-kitchen-preview.vercel.app'
  try {
    const request = mockRequest({
      host: 'personal-kitchen-preview.vercel.app',
      protocol: 'http',
      forwardedHost: 'project.supabase.co',
      forwardedProto: 'http'
    })
    assert.equal(resolveApiBase(request), 'https://personal-kitchen-preview.vercel.app')
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.IMPORT_PUBLIC_ORIGIN
    else process.env.IMPORT_PUBLIC_ORIGIN = previousPublicOrigin
    if (previousVercelUrl === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = previousVercelUrl
  }
})

test('本地运行只使用实际 Host，不信任 x-forwarded-host', () => {
  const previousPublicOrigin = process.env.IMPORT_PUBLIC_ORIGIN
  const previousVercelUrl = process.env.VERCEL_URL
  delete process.env.IMPORT_PUBLIC_ORIGIN
  delete process.env.VERCEL_URL
  try {
    const request = mockRequest({
      host: '127.0.0.1:3210',
      protocol: 'http',
      forwardedHost: 'project.supabase.co',
      forwardedProto: 'https'
    })
    assert.equal(resolveApiBase(request), 'http://127.0.0.1:3210')
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.IMPORT_PUBLIC_ORIGIN
    else process.env.IMPORT_PUBLIC_ORIGIN = previousPublicOrigin
    if (previousVercelUrl === undefined) delete process.env.VERCEL_URL
    else process.env.VERCEL_URL = previousVercelUrl
  }
})
