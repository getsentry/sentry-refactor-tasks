# Changelog

## 0.2.0

### New Features ✨

- (scanner) Log elapsed time for each pattern scan by @ryan953 in [#18](https://github.com/getsentry/sentry-refactor-tasks/pull/18)

### Bug Fixes 🐛

#### Scanner

- Fail loudly when a detect command can't be trusted by @ryan953 in [#20](https://github.com/getsentry/sentry-refactor-tasks/pull/20)
- Stop building pattern shell commands from the repo path by @ryan953 in [#17](https://github.com/getsentry/sentry-refactor-tasks/pull/17)

#### Other

- (ci) Restrict GITHUB_TOKEN permissions in the build workflow by @ryan953 in [#16](https://github.com/getsentry/sentry-refactor-tasks/pull/16)

## 0.1.1

### Bug Fixes 🐛

- (reporter) Deliver all findings and fail loud when data doesn't reach Sentry by @ryan953 in [#15](https://github.com/getsentry/sentry-refactor-tasks/pull/15)

## 0.1.0

### New Features ✨

- (config) Configure via env vars and CLI, drop repo.yaml by @ryan953 in [#14](https://github.com/getsentry/sentry-refactor-tasks/pull/14)
- (inference) Add OpenRouter API backend selectable via env by @ryan953 in [#13](https://github.com/getsentry/sentry-refactor-tasks/pull/13)

## 0.0.5

### Bug Fixes 🐛

- (reporter) Chunk Sentry sends to survive spike protection by @ryan953 in [#12](https://github.com/getsentry/sentry-refactor-tasks/pull/12)

### Internal Changes 🔧

- Ignore the cache/ folder by @ryan953 in [#11](https://github.com/getsentry/sentry-refactor-tasks/pull/11)

## 0.0.4

### Bug Fixes 🐛

- (cache) Store cache at a stable user-level path by @ryan953 in [#10](https://github.com/getsentry/sentry-refactor-tasks/pull/10)

## 0.0.3

### Bug Fixes 🐛

- (build) Compile to JS for publish so the CLI runs from node_modules by @ryan953 in [#9](https://github.com/getsentry/sentry-refactor-tasks/pull/9)

## 0.0.2

- Initial public release scaffolding: published to npm as `@sentry/refactor-tasks`
  via [craft](https://github.com/getsentry/craft).

