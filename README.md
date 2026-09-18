# Job Tracker Extension

A zero-server Chrome extension that monitors your Gmail inbox for job application emails, classifies them with OpenAI, auto-creates Gmail labels, and shows a dashboard — all privately on your own machine.

## Status: 🚧 In Development

See [PLAN.md](./PLAN.md) for the full implementation plan.

## Stack
- Chrome Manifest V3
- TypeScript + esbuild
- Gmail REST API (OAuth 2.0)
- OpenAI gpt-4o-mini
- chrome.storage.local (no database, no server)
