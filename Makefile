# agents-clubhouse plugin repository: the install, test, check, build and pack targets (docs/features.md). pack writes the release with pnpm pack.
.PHONY: install test check build pack check-push install-hooks

# The installation stage (core docs/spec/plugins.md#repositories): it installs the locked dependencies; the tests, checks and packs consume them without installing.
install:
	pnpm install --frozen-lockfile

# test checks the types and runs the tests of this plugin.
test:
	pnpm run typecheck
	pnpm test

# check runs the record check and the command name check of the kit release that package.json pins.
check:
	pnpm exec sok-check docs
	pnpm exec sok-check commands

# build writes ui/clubhouse.js from src/main.ts; package.json ships it with the page.
build:
	pnpm run build

pack: check build
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	pnpm pack --pack-destination $(OUT)

# The checks that a push needs: the commit messages and the checklist history of the pushed range, because a published commit
# is kept; CI runs the tests and checks on the pushed commits.
# RANGE holds the commits of the pushed refs; the pre-push hook sets it, and it defaults to origin/main..HEAD.
check-push:
	pnpm exec sok-check commits "$(or $(RANGE),origin/main..HEAD)"
	pnpm exec sok-check docs --range "$(or $(RANGE),origin/main..HEAD)"

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
install-hooks:
	@git config core.hooksPath .githooks
