# MAHEER STORE — Premium v4

Premium skincare e-commerce site with Turso persistence, Gemini AI chat ordering, customer reviews, admin panel and Render deployment.

## Render
Build: `npm install`
Start: `npm start`

## Environment variables
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN` (write-enabled)
- `ADMIN_PASSWORD`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.1-flash-lite`

The AI uses Gemini function calling to create real orders in Turso after customer confirmation. Customer reviews are stored in Turso and manageable from Admin Panel.
