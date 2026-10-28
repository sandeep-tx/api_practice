# API Practice Lab (Flask + static frontend)

A small educational sandbox for CRUD API automation and authentication practice. The UI reflects API-backed CRUD changes in a table and includes an API request console, OTP/session flow, password login, and a protected endpoint.

## 1. Run locally (macOS / Windows / Linux)

Python 3.10+ recommended.

```bash
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**. API docs are available at `GET http://127.0.0.1:5000/api/docs`.

Demo password login:
- Email: `learner@example.com`
- Password: `Practice@123`

You can override credentials and secrets with `DEMO_EMAIL`, `DEMO_PASSWORD`, and `SECRET_KEY` environment variables.

## 2. CRUD behavior

- `GET /api/items` lists the rows shown in the UI.
- `POST /api/items` creates a row; UI table refreshes when the page reloads or the Refresh button is clicked.
- `PUT /api/items/{id}` replaces the row fields.
- `PATCH /api/items/{id}` updates only fields supplied.
- `DELETE /api/items/{id}` removes a row.
- `POST /api/items/reset` clears all rows.

Example create body:

```json
{
  "name": "Wireless keyboard",
  "category": "Accessories",
  "quantity": 2,
  "price": 1299.00
}
```

## 3. OTP login flow

1. `POST /api/auth/otp/send` with `{"mobile":"9876543210"}` returns a `session_id`.
2. `POST /api/auth/otp/get` with `{"session_id":"..."}` returns the generated practice OTP. The server encrypts the OTP using a key derived from the session ID and decrypts it for this learning endpoint.
3. `POST /api/auth/otp/verify` with `{"session_id":"...","otp":"123456"}` returns a Bearer token if valid.
4. Use `Authorization: Bearer <token>` for `/api/auth/me`.

OTP is random six digits, expires in five minutes, and permits at most five verification attempts. OTP retrieval intentionally exposes the code for local testing; it is **not a real SMS service**.

## 4. Password API login

`POST /api/auth/login`:

```json
{"email":"learner@example.com","password":"Practice@123"}
```

Response includes `token`, `token_type`, `expires_in_seconds`, and a demo user object. Use `Authorization: Bearer <token>` for protected endpoints. `POST /api/auth/logout` invalidates the token.

## 5. Playwright example

```js
import { test, expect } from '@playwright/test';

test('create a record using API and observe it in the UI', async ({ request, page }) => {
  const baseURL = 'http://127.0.0.1:5000';
  const created = await request.post(`${baseURL}/api/items`, {
    data: { name: 'Playwright API item', category: 'Automation', quantity: 3, price: 25.5 }
  });
  expect(created.status()).toBe(201);
  const item = (await created.json()).data;

  await page.goto(baseURL);
  await expect(page.getByText('Playwright API item')).toBeVisible();

  const deleted = await request.delete(`${baseURL}/api/items/${item.id}`);
  expect(deleted.ok()).toBeTruthy();
});
```

## 6. Netlify deployment (important)

**Netlify does not run a persistent Flask server.** Deploy `frontend/` to Netlify for the UI and deploy the Flask app separately (Render/Railway or another Python host).

1. Deploy this repository to Render using the included `render.yaml` (or set build command `pip install -r requirements.txt` and start command `gunicorn app:app`).
2. Set backend environment variables: `SECRET_KEY` (long random value), `DEMO_EMAIL`, `DEMO_PASSWORD`, and `CORS_ORIGINS` to your exact Netlify site origin (for example `https://your-site.netlify.app`; comma-separated origins are supported by Flask-CORS).
3. In `frontend/config.js`, change `window.API_BASE_URL` to the deployed Flask API origin, e.g. `https://your-api.onrender.com` (no trailing slash). Commit and redeploy the frontend to Netlify.
4. In Netlify, publish directory is `frontend/`; `netlify.toml` is included.

For CORS, if you need multiple origins, set `CORS_ORIGINS` to a comma-separated list. Test the API `/health` endpoint after deployment.

## Limitations / safety

- This is a practice lab, not production-ready authentication.
- Data, OTP sessions, and tokens are held in memory and reset on restart; use a database for persistence.
- The OTP retrieval endpoint is intentionally insecure for training. Never use real phone numbers or passwords.
- Do not put a Flask secret or production credentials in the static frontend.
- The UI's CRUD table refreshes from the API; if an external Postman request creates/updates/deletes a row while the page is already open, click **Refresh** to sync it.
