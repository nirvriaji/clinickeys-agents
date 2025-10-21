# Carga el .env automáticamente si existe
ifneq (,$(wildcard .env))
  include .env
  export
endif

SST := npx sst
AWS_ARGS := AWS_PROFILE=$(AWS_PROFILE)

BRANCH_NAME := $(shell git rev-parse --abbrev-ref HEAD)

.PHONY: local remove-local deploy remove push push-dev push-test push-main _guard_deploy

# ---------- Helpers ----------
define require_branch
	@if [ "$(BRANCH_NAME)" != "$(1)" ]; then \
	  echo "❌ Estás en '$(BRANCH_NAME)'. Cambia a '$(1)' para ejecutar este objetivo."; \
	  exit 1; \
	fi
endef

_guard_deploy:
	@if [ -z "$(STAGE)" ]; then \
	  echo "STAGE no está seteado. Uso: make <deploy|remove> STAGE=<dev|testing|production>"; \
	  exit 1; \
	fi
	@case "$(BRANCH_NAME)" in \
	  dev)   [ "$(STAGE)" = "dev" ] || { echo "En rama 'dev' usa STAGE=dev"; exit 1; } ;; \
	  test)  [ "$(STAGE)" = "testing" ] || { echo "En rama 'test' usa STAGE=testing"; exit 1; } ;; \
	  main)  [ "$(STAGE)" = "production" ] || { echo "En rama 'main' usa STAGE=production"; exit 1; } ;; \
	  *)     echo "Solo puedes desplegar/eliminar desde 'dev', 'test' o 'main' (rama actual: '$(BRANCH_NAME)')."; exit 1 ;; \
	esac

# ---------- Desarrollo local ----------
local:
	@$(AWS_ARGS) $(SST) dev --stage dev

remove-local:
	@$(AWS_ARGS) $(SST) remove --stage dev

# ---------- Deploy / Remove con guard ----------
deploy: _guard_deploy
	@$(AWS_ARGS) $(SST) deploy --stage $(STAGE)

remove: _guard_deploy
	@$(AWS_ARGS) $(SST) remove --stage $(STAGE)

# ---------- Push seguros ----------
# 'make push' empuja la rama actual al mismo nombre remoto,
# solo si la rama es dev/test/main.
push:
	@case "$(BRANCH_NAME)" in \
	  dev|test|main) ;; \
	  *) echo "Solo puedes usar 'make push' desde dev/test/main (rama actual: '$(BRANCH_NAME)')."; exit 1 ;; \
	esac
	@git push origin "$(BRANCH_NAME)"

push-dev:
	$(call require_branch,dev)
	@git push origin dev

push-test:
	$(call require_branch,test)
	@git push origin test

push-main:
	$(call require_branch,main)
	@git push origin main
