# hugmesh-wiki-ui — developer make targets.
#
# `make pentest` runs the SAME OWASP pen-test checks the CI `pentest` stage runs
# (see .gitlab-ci.yml + the generator's tests/pentest/ci/pentest-stage.gitlab-ci.yml),
# but repo-locally so a dev can self-scan before pushing. It is self-contained and
# does NOT hard-fail when tooling or a DAST target is absent.
#
# DEV / CI-PIPELINE ONLY — this is not a deployed feature.

.PHONY: pentest pentest-sca pentest-dast

# Where the shared DAST harness lives. Override to a vendored/cloned checkout,
# e.g. make pentest GENERATOR_DIR=/path/to/hugmesh-generator
GENERATOR_DIR ?= ../hugmesh-generator
PENTEST_HARNESS ?= $(GENERATOR_DIR)/tests/pentest/run-pentest.sh
# Optional: spun-up app URL for the DAST baseline. When empty, DAST is skipped.
DAST_TARGET_URL ?=

pentest: pentest-sca pentest-dast ## Run the local OWASP pen-test self-scan (SCA + DAST)

# SCA — mirrors .pentest-sca. This is an Angular/npm repo, so the fast local
# self-scan is `npm audit` at the CI severity gate. (The CI `pentest:sca` job
# additionally runs OWASP Dependency-Check via the owasp/dependency-check image
# for the SARIF/security-widget feed; run it locally with:
#   docker run --rm -v "$$PWD:/src" owasp/dependency-check:latest \
#     --scan /src --failOnCVSS 7 --enableExperimental --format HTML --out /src/reports/sca )
pentest-sca: ## SCA self-scan (npm audit, mirrors CI severity gate)
	@echo "==> SCA: npm audit --audit-level=high"
	@if command -v npm >/dev/null 2>&1; then \
		npm audit --audit-level=high || echo "   (npm audit reported findings — review above; non-blocking locally)"; \
	else \
		echo "   npm not found — skipping SCA self-scan (CI runs OWASP Dependency-Check)"; \
	fi

# DAST — mirrors .pentest-dast-baseline by delegating to the shared harness
# (run-pentest.sh spins the ZAP baseline + custom probes + nuclei). Needs Docker
# and a target; skipped cleanly when DAST_TARGET_URL is unset or the harness is
# not checked out locally.
pentest-dast: ## DAST baseline against $DAST_TARGET_URL via the generator harness
	@echo "==> DAST: ZAP baseline + probes + nuclei (shared harness)"
	@if [ -z "$(DAST_TARGET_URL)" ]; then \
		echo "   DAST_TARGET_URL not set — skipping DAST. To run:"; \
		echo "     make pentest DAST_TARGET_URL=http://localhost:4200"; \
	elif [ -x "$(PENTEST_HARNESS)" ]; then \
		echo "   DAST_TARGET_URL=$(DAST_TARGET_URL)"; \
		echo "   exec: bash $(PENTEST_HARNESS) --env compose --scan baseline --pipeline main"; \
		DAST_TARGET_URL="$(DAST_TARGET_URL)" bash "$(PENTEST_HARNESS)" --env compose --scan baseline --pipeline main || \
			echo "   (harness reported findings/errors — review above; non-blocking locally)"; \
	else \
		echo "   harness not found at $(PENTEST_HARNESS)."; \
		echo "   Clone it, then re-run, e.g.:"; \
		echo "     git clone https://github.com/hugmesh-net/hugmesh-generator $(GENERATOR_DIR)"; \
		echo "     make pentest DAST_TARGET_URL=$(DAST_TARGET_URL) GENERATOR_DIR=$(GENERATOR_DIR)"; \
	fi
