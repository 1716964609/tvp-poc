import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db'

const app = new Hono()

const jobServiceUrl =
  process.env.JOB_SERVICE_URL ?? 'http://localhost:8080'

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.get('/career/jobs', async (c) => {
  const response = await fetch(`${jobServiceUrl}/jobs`)

  if (!response.ok) {
    return c.json(
      { error: 'Failed to fetch jobs from Job Domain' },
      502
    )
  }

  const jobs = await response.json()

  return c.json(jobs)
})

app.post('/career/saved-jobs', async (c) => {
  const body = await c.req.json()

  const { userId, jobId } = body

  if (!userId || !jobId) {
    return c.json(
      { error: 'userId and jobId are required' },
      400
    )
  }

  // Jobの存在確認もShared Domain経由
  const jobResponse = await fetch(
    `${jobServiceUrl}/jobs/${jobId}`
  )

  if (jobResponse.status === 404) {
    return c.json(
      { error: 'Job not found' },
      404
    )
  }

  if (!jobResponse.ok) {
    return c.json(
      { error: 'Failed to validate job' },
      502
    )
  }

  const result = await db.query(
    `
    INSERT INTO career.saved_jobs (
      user_id,
      job_id
    )
    VALUES ($1, $2)
    ON CONFLICT (user_id, job_id) DO NOTHING
    RETURNING
      user_id AS "userId",
      job_id AS "jobId",
      created_at AS "createdAt"
    `,
    [userId, jobId]
  )

  if (result.rowCount === 0) {
    return c.json(
      { error: 'Job already saved' },
      409
    )
  }

  return c.json(result.rows[0], 201)
})

serve({
  fetch: app.fetch,
  port: 8082,
})

console.log('Career API running on http://localhost:8082')
