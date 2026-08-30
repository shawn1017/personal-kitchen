import app from '../import-service/src/server.js'

export default function handler(request: Parameters<typeof app>[0], response: Parameters<typeof app>[1]) {
  return app(request, response)
}
