import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // ramp up to 20 users
    { duration: '1m', target: 20 },  // stay at 20 users
    { duration: '30s', target: 0 },  // ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
  },
};

export default function () {
  const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/healthz/ready`);
  check(healthRes, { 'status was 200': (r) => r.status === 200 });

  // 2. Metrics check (simulating Prometheus scrape)
  const metricsRes = http.get(`${BASE_URL}/metrics`);
  check(metricsRes, { 'metrics status was 200': (r) => r.status === 200 });

  sleep(1);
}
