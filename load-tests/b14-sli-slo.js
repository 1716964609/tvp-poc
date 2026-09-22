import http from 'k6/http'
import { check } from 'k6'

export const options = {
  scenarios: {
    browse_jobs: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 10,
      maxVUs: 50,
      exec: 'browseJobs',
    },

    publish_job: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'publishJob',
    },
  },

  thresholds: {
    'http_req_failed{journey:browse_jobs}': [
      'rate<0.01',
    ],

    'http_req_duration{journey:browse_jobs}': [
      'p(95)<500',
    ],

    'http_req_failed{journey:publish_job}': [
      'rate<0.01',
    ],

    'http_req_duration{journey:publish_job}': [
      'p(95)<1000',
    ],
  },
}

export function browseJobs() {
  const response = http.get(
    'http://localhost:8082/career/jobs',
    {
      tags: {
        journey: 'browse_jobs',
      },
    }
  )

  check(response, {
    'browse returns 200': (r) => r.status === 200,
  })
}

export function publishJob() {
  const payload = JSON.stringify({
    title: `B14 SLI Test ${Date.now()}-${__VU}-${__ITER}`,
    description: 'Synthetic SLI/SLO validation request',
    location: 'Tokyo',
    salaryMin: 8000000,
    salaryMax: 10800000,
    hiringTeam: 'Platform Team',
    internalNote: 'B14 synthetic SLO test',
  })

  const response = http.post(
    'http://localhost:8081/hire/jobs',
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
      },

      tags: {
        journey: 'publish_job',
      },
    }
  )

  check(response, {
    'publish returns 201': (r) => r.status === 201,
  })
}
