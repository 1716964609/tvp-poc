import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('TVP Job Asset Service')
})

app.get('/health', (c) => {
  return c.json({
    status: 'ok'
  })
})

app.get('/jobs', (c) => {
  return c.json([
    {
      id: 'job-001',
      title: 'Platform Engineer',
      company: 'TVP Mock Company',
      status: 'open'
    }
  ])
})

serve({
  fetch: app.fetch,
  port: 8080
})

console.log('Job Asset Service running on http://localhost:8080')