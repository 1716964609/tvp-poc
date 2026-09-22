import { Hono } from 'hono'
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api'
import { db } from './db'
import { randomUUID } from 'node:crypto'


export const app = new Hono()

const tracer = trace.getTracer('job-asset-service')

// OTel middleware
app.use('*', async (c, next) => {
  const traceparent = c.req.header('traceparent')
  const tracestate = c.req.header('tracestate')
  const carrier: Record<string, string> = {}

  if (traceparent) {
    carrier['traceparent'] = traceparent
  }

  if (tracestate) {
    carrier['tracestate'] = tracestate
  }

  const parentContext = propagation.extract(
    context.active(),
    carrier
  )

  await tracer.startActiveSpan(
    `${c.req.method} ${c.req.path}`,
    {},
    parentContext,
    async (span) => {
      try {
        span.setAttribute(
          'http.request.method',
          c.req.method
        )

        span.setAttribute(
          'url.path',
          c.req.path
        )

        await next()

        span.setAttribute(
          'http.response.status_code',
          c.res.status
        )

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
    status: 'ok',
  })
})

app.get('/jobs', async (c) => {
  const result = await db.query(`
    SELECT
      id,
      title,
      description,
      location,
      salary_min AS "salaryMin",
      salary_max AS "salaryMax",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM job.jobs
    ORDER BY created_at DESC
  `)

  return c.json(result.rows)
})

app.post('/jobs', async (c) => {
  const body = await c.req.json()

  const {
    title,
    description,
    location,
    salaryMin,
    salaryMax,
  } = body

  if (
    !title ||
    !description ||
    !location ||
    !Number.isInteger(salaryMin) ||
    !Number.isInteger(salaryMax)
  ) {
    return c.json(
      { error: 'Invalid job payload' },
      400
    )
  }

  if (salaryMin > salaryMax) {
    return c.json(
      { error: 'salaryMin must not exceed salaryMax' },
      400
    )
  }

  const id = randomUUID()

  const result = await db.query(
    `
    INSERT INTO job.jobs (
      id,
      title,
      description,
      location,
      salary_min,
      salary_max,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'open')
    RETURNING
      id,
      title,
      description,
      location,
      salary_min AS "salaryMin",
      salary_max AS "salaryMax",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      id,
      title,
      description,
      location,
      salaryMin,
      salaryMax,
    ]
  )

  return c.json(result.rows[0], 201)
})

app.get('/jobs/:id', async (c) => {
  const id = c.req.param('id')

  const result = await db.query(
    `
    SELECT
      id,
      title,
      description,
      location,
      salary_min AS "salaryMin",
      salary_max AS "salaryMax",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM job.jobs
    WHERE id = $1
    `,
    [id]
  )

  if (result.rowCount === 0) {
    return c.json(
      { error: 'Job not found' },
      404
    )
  }

  return c.json(result.rows[0])
})