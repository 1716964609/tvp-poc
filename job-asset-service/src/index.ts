import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { trace, SpanStatusCode } from '@opentelemetry/api'

const app = new Hono()
const tracer = trace.getTracer('job-asset-service')

app.use('*', async (c, next) => {
  await tracer.startActiveSpan(
    `${c.req.method} ${c.req.path}`,
    async (span) => {
      try {
        span.setAttribute('http.request.method', c.req.method)
        span.setAttribute('url.path', c.req.path)

        await next()

        span.setAttribute('http.response.status_code', c.res.status)

        span.setStatus({
          code:
            c.res.status >= 500
              ? SpanStatusCode.ERROR
              : SpanStatusCode.OK,
        })
      } catch (error) {
        span.recordException(
          error instanceof Error
            ? error
            : new Error(String(error))
        )

        span.setStatus({
          code: SpanStatusCode.ERROR,
        })

        throw error
      } finally {
        span.end()
      }
    }
  )
})


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