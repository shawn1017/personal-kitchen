import { createGateway } from './gateway.ts'

const gateway = createGateway({
  upstreamOrigin: Deno.env.get('VERCEL_PREVIEW_ORIGIN') || '',
  bypassSecret: Deno.env.get('VERCEL_BYPASS_SECRET') || '',
  accessKey: Deno.env.get('KITCHEN_GATEWAY_KEY') || '',
  allowedOrigin: Deno.env.get('KITCHEN_ALLOWED_ORIGIN') || 'https://shawn1017.github.io'
})

Deno.serve(gateway)
