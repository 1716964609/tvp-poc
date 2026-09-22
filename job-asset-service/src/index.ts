import { serve } from '@hono/node-server'
import { app } from './app'

serve({
  fetch: app.fetch,
  port: 8080,
})

console.log('Job Asset Service running on http://localhost:8080')