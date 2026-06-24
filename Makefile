.PHONY:
help:
	@echo Tasks:
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

clone-libs: ## Clone all required external libraries
	bun ./scripts/clone-libs.ts

# Misc tasks
clean-files: ## Remove all generated files
	rm -rf node_modules && \
	bun i
