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

app.get('/', (c) => {
  return c.html(`
<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Mock Career</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
    }

    .job {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
    }

    button {
      font: inherit;
      padding: 8px 14px;
      cursor: pointer;
    }

    #status {
      margin: 20px 0;
      padding: 12px;
      background: #f4f4f4;
    }
  </style>
</head>
<body>
  <h1>Mock Career</h1>
  <p>
    Jobs are read through the Shared Job Domain.
  </p>

  <div id="status">Loading jobs...</div>
  <div id="jobs"></div>

  <script>
    const jobsContainer = document.getElementById('jobs')
    const status = document.getElementById('status')

    async function loadJobs() {
      const response = await fetch('/career/jobs')
      const jobs = await response.json()

      jobsContainer.innerHTML = ''

      for (const job of jobs) {
        const element = document.createElement('div')
        element.className = 'job'

        element.innerHTML = \`
          <h2>\${job.title}</h2>

          <p>\${job.description}</p>

          <p>
            <strong>Location:</strong>
            \${job.location}
          </p>

          <p>
            <strong>Salary:</strong>
            ¥\${job.salaryMin.toLocaleString()}
            -
            ¥\${job.salaryMax.toLocaleString()}
          </p>

          <p>
            <strong>Status:</strong>
            \${job.status}
          </p>

          <button data-job-id="\${job.id}">
            Save Job
          </button>
        \`

        const button = element.querySelector('button')

        button.addEventListener('click', async () => {
          status.textContent = 'Saving...'

          const response = await fetch(
            '/career/saved-jobs',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: 'candidate-ui-001',
                jobId: job.id,
              }),
            }
          )

          const body = await response.json()

          status.textContent =
            JSON.stringify(body, null, 2)
        })

        jobsContainer.appendChild(element)
      }

      status.textContent =
        \`Loaded \${jobs.length} jobs.\`
    }

    loadJobs()
  </script>
</body>
</html>
  `)
})

serve({
  fetch: app.fetch,
  port: 8082,
})

console.log('Career API running on http://localhost:8082')
