# Frontend

The Next.js app for Receipt Tracker. See the [main README](../README.md) for
what the project does and how to run it with Docker Compose.

| Command (inside the `frontend` container) | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then run the TypeScript compiler |
| `npm test` | Run the Vitest tests once |
| `npm run test:watch` | Rerun tests when files change |
| `npm run generate:api` | Regenerate `src/lib/api-types.ts` from the running backend |

Run a command with `docker compose exec frontend <command>`.
