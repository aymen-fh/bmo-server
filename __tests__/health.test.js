const request = require('supertest');

// server.js exports the Express app.
// In test env, server.js should not bind to a port.
const app = require('../server');

describe('Black-box: GET /health', () => {
  it('returns ok status payload', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptimeSeconds');
    expect(res.body).toHaveProperty('jwt');
    expect(res.body).toHaveProperty('db');
  });
});
