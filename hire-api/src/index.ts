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

app.get('/', (c) => {
  return c.html(`
<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Mock Hire</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 720px;
      margin: 40px auto;
      padding: 0 20px;
    }

    form {
      display: grid;
      gap: 12px;
    }

    input, textarea, button {
      font: inherit;
      padding: 10px;
    }

    textarea {
      min-height: 100px;
    }

    button {
      cursor: pointer;
    }

    pre {
      margin-top: 24px;
      padding: 16px;
      background: #f4f4f4;
      overflow: auto;
    }
  </style>
</head>
<body>
  <h1>Mock Hire</h1>
  <p>Create a canonical Job through the Shared Job Domain.</p>

  <form id="job-form">
    <input name="title" placeholder="Job title" required />

    <textarea
      name="description"
      placeholder="Description"
      required
    ></textarea>

    <input name="location" value="Tokyo" required />

    <input
      name="salaryMin"
      type="number"
      placeholder="Salary Min"
      required
    />

    <input
      name="salaryMax"
      type="number"
      placeholder="Salary Max"
      required
    />

    <input
      name="hiringTeam"
      placeholder="Hiring Team"
      required
    />

    <textarea
      name="internalNote"
      placeholder="Internal Note"
    ></textarea>

    <button type="submit">Create Job</button>
  </form>

  <pre id="result">Ready.</pre>

  <script>
    const form = document.getElementById('job-form')
    const result = document.getElementById('result')

    form.addEventListener('submit', async (event) => {
      event.preventDefault()

      const data = new FormData(form)

      const payload = {
        title: data.get('title'),
        description: data.get('description'),
        location: data.get('location'),
        salaryMin: Number(data.get('salaryMin')),
        salaryMax: Number(data.get('salaryMax')),
        hiringTeam: data.get('hiringTeam'),
        internalNote: data.get('internalNote'),
      }

      result.textContent = 'Creating...'

      const response = await fetch('/hire/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const body = await response.json()

      result.textContent =
        JSON.stringify(body, null, 2)
    })
  </script>
</body>
</html>
  `)
})

serve({
  fetch: app.fetch,
  port: 8081,
})

console.log(
  'Hire API running on http://localhost:8081'
)