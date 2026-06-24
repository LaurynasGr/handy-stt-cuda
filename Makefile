.PHONY:
help:
	@echo Tasks:
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Scripts
clone-libs: ## Clone all required external libraries
	bun ./scripts/clone-libs.ts

setup-deps: ## Setup all OS-level dependencies
	bun ./scripts/setup-deps.ts

patch-cuda-headers: ## Patch CUDA headers for the system glibc
	bun ./scripts/patch-cuda-headers.ts

# Code quality
lint: ## Run linters
	bun run lint

lint-fix: ## Fix linting issues
	bun run lint:fix

# Misc tasks
clean-files: ## Remove all generated files
	rm -rf node_modules && \
	bun i
