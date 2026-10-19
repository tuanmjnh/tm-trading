// LOCAL DEV VERIFICATION ONLY — stand-in for tm-hub on :4000 while it is down.
// Not imported by the product. Answers the two calls the satellite makes on a
// hard reload (auth/me, auth/routes) plus auth/refresh, with CORS so the
// browser can reach them. Run: HUB_STUB_TOKEN=... node scripts/dev-hub-stub.mjs
import { createServer } from 'node:http'
import { decodeJwt } from 'jose'

const PORT = Number(process.env.HUB_STUB_PORT || 4000)
const TOKEN = process.env.HUB_STUB_TOKEN || ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, accept, x-app-id, x-request-id',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-max-age': '600',
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  const path = new URL(req.url || '/', `http://localhost:${PORT}`).pathname
  console.log(`[hub-stub] ${req.method} ${path}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  if (path === '/api/v1/auth/me') {
    let claims = {}
    try { claims = TOKEN ? decodeJwt(TOKEN) : {} } catch { claims = {} }
    return json(res, 200, {
      success: true,
      data: {
        userId: claims.sub || 'dev-user',
        email: claims.email || 'dev@local',
        name: claims.name || 'Dev User',
        roles: claims.roles || ['admin'],
        permissions: claims.permissions || ['*'],
        platform: 'web',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
  }

  if (path === '/api/v1/auth/routes') return json(res, 200, { success: true, data: [] })

  if (path === '/api/v1/auth/refresh') {
    if (!TOKEN) return json(res, 401, { success: false, message: 'no stub token' })
    return json(res, 200, {
      success: true,
      data: { accessToken: TOKEN, refreshToken: 'dev-refresh', expiresIn: 3600 },
    })
  }

  return json(res, 404, { success: false, message: `hub-stub: no route for ${path}` })
}).listen(PORT, () => console.log(`[hub-stub] listening on http://localhost:${PORT}`))
