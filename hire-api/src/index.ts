import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db'

const app = new Hono()

const jobServiceUrl =
  process.env.JOB_SERVICE_URL ?? 'http://localhost:8080'

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.post('/hire/jobs', async (c) => {
  const body = await c.req.json()

  const {
    title,
    description,
    location,
    salaryMin,
    salaryMax,
    hiringTeam,
    internalNote,
  } = body

  if (
    !title ||
    !description ||
    !location ||
    !Number.isInteger(salaryMin) ||
    !Number.isInteger(salaryMax) ||
    !hiringTeam
  ) {
    return c.json(
      { error: 'Invalid hire job payload' },
      400
    )
  }

  // Shared Job Domain に canonical Job を作らせる
  const jobResponse = await fetch(
    `${jobServiceUrl}/jobs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        description,
        location,
        salaryMin,
        salaryMax,
      }),
    }
  )

  if (!jobResponse.ok) {
    const error = await jobResponse.json()

    return c.json(
      {
        error: 'Job domain rejected request',
        details: error,
      },
      jobResponse.status as 400 | 500
    )
  }

  const job = await jobResponse.json() as {
    id: string
    title: string
    description: string
    location: string
    salaryMin: number
    salaryMax: number
    status: string
    createdAt: string
    updatedAt: string
  }

  // Hire固有データだけHire schemaへ保存
  const metadataResult = await db.query(
    `
    INSERT INTO hire.job_metadata (
      job_id,
      hiring_team,
      internal_note
    )
    VALUES ($1, $2, $3)
    RETURNING
      job_id AS "jobId",
      hiring_team AS "hiringTeam",
      internal_note AS "internalNote",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    `,
    [
      job.id,
      hiringTeam,
      internalNote ?? null,
    ]
  )

  return c.json(
    {
      job,
      hireMetadata: metadataResult.rows[0],
    },
    201
  )
})

serve({
  fetch: app.fetch,
  port: 8081,
})

console.log(
  'Hire API running on http://localhost:8081'
)