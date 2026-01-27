const request = require('supertest');

// server.js exports the Express app
const app = require('../server');

describe('Auth API - black box validation (no DB)', () => {
  test('POST /api/auth/login with missing fields returns 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
    });
    expect(String(res.body.message)).toContain('Please provide email and password');
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
    });
  });

  test('GET /api/children without token returns 401', async () => {
    const res = await request(app).get('/api/children');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
    });
  });
});
