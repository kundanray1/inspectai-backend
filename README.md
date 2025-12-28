# Sitewise Backend

## Environment Variables

Create a `.env` file in the `backend/` directory. The following keys are required:

```env
# Core
NODE_ENV=development
PORT=4000
MONGODB_URL=mongodb://localhost:27017/sitewise
JWT_SECRET=change-me

# Frontend + uploads
FRONTEND_URL=http://localhost:5173
UPLOAD_DIR=backend/uploads

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_AUTO_START=true
RABBITMQ_PREFETCH=5
INSPECTION_QUEUE_EXCHANGE=sitewise.inspection
INSPECTION_QUEUE_NAME=sitewise.inspection.analysis
INSPECTION_QUEUE_ROUTING_KEY=inspection.analysis
INSPECTION_QUEUE_MAX_PENDING=500
INSPECTION_WORKER_PREFETCH=5
INSPECTION_WORKER_CONCURRENCY=2

# Ollama (local LLM)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL_SCHEMA=llama3.1
OLLAMA_MODEL_INSPECTION=llama3.1

# Stripe Billing
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_STARTER=price_trial_optional
STRIPE_BILLING_RETURN_URL=http://localhost:5173/app/billing
STRIPE_WEBHOOK_SECRET=whsec_...

# Seeded Super Admin
SUPER_ADMIN_EMAIL=raykundan57@gmail.com
SUPER_ADMIN_PASSWORD=change-me
SUPER_ADMIN_NAME=Ray Kundan
```

- `STRIPE_SECRET_KEY` is mandatory for live billing flows (checkout, portal, cancel/resume).
- `STRIPE_PRICE_PRO` should map to the recurring product/price representing the Pro (20 inspections) plan.
- `STRIPE_PRICE_STARTER` can be left blank unless you expose a paid starter tier.
- `STRIPE_BILLING_RETURN_URL` controls where Stripe sends users after checkout/portal.
- `STRIPE_WEBHOOK_SECRET` is required for verifying Stripe webhook calls (Checkout, billing events).
- Expose your webhook endpoint as `POST /v1/billing/webhook` (or `/api/billing/webhook`) when registering the Stripe CLI webhook listener.
- When `RABBITMQ_AUTO_START=true`, the API will attempt to run `docker compose up -d rabbitmq` on boot if the broker is unreachable.
- Set `OLLAMA_URL` to the host running your local Ollama models; both schema extraction and inspection generation use the configured models.
- Inspection workers can be started with `yarn worker:inspection` (development) or via PM2 (`inspection-worker` app, two instances by default).
