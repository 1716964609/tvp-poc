import http from 'k6/http'
import { check } from 'k6'

export const options = {
  scenarios: {
    steady_traffic: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
}

export default function () {
  const response = http.get(
    `${__ENV.BASE_URL}/jobs`,
    {
      tags: {
        experiment: 'b15-k8s-self-healing',
      },
    }
  )

  check(response, {
    'status is 200': (r) => r.status === 200,
  })
}
