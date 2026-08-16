# Contributing to Daeva

First off, thank you for considering contributing to Daeva! It's people like you that make this community tool great.

## How to Set Up Development

1. Fork the repository and clone it locally.
2. Ensure you have Node.js v25+ installed.
3. Install dependencies: `npm install`
4. Set up the local Cloudflare D1 database:
   ```bash
   npx wrangler d1 execute player-cache --local --command="CREATE TABLE IF NOT EXISTS player_cache (character_id TEXT NOT NULL, server_id TEXT NOT NULL, region TEXT, equip_data TEXT NOT NULL, equip_details TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (character_id, server_id))"
   ```
5. Run the development server: `npm run dev`

## Pull Request Process

1. **Branching**: Create a new branch for your feature or bug fix (e.g., `feature/add-new-chart` or `fix/cache-bug`).
2. **Code Style**: We use Prettier and ESLint. Please ensure your code passes linting by running `npm run lint`.
3. **Tests**: If you add new functionality, please add corresponding tests. Ensure all tests pass by running `npm run test` before submitting your PR.
4. **Focused PRs**: Keep your Pull Requests focused on a single issue or feature. Avoid bundling multiple unrelated changes.
5. **Commit Messages**: Write clear, descriptive commit messages.

## Reporting Bugs

When filing a bug report, please provide:

- A clear description of what happened.
- The expected behavior.
- The Class/Leaderboard you were analyzing.
- Your browser and operating system.
- Steps to reproduce the issue.
- Screenshots or console logs if appropriate.

## Proposing Features

When requesting a feature, please include:

- The problem or use case you are trying to solve.
- Your proposed improvement or feature.
- Any alternatives you have considered.
