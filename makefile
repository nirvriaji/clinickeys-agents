# Carga el .env automáticamente si existe
ifneq (,$(wildcard .env))
  include .env
  export
endif

SST := npx sst
AWS_ARGS := AWS_PROFILE=$(AWS_PROFILE)

BRANCH_NAME := $(shell git rev-parse --abbrev-ref HEAD)

.PHONY: doctor sst-dev sst-deploy sst-remove sst-unlock sst-refresh sst-repair _guard_env _guard_deploy _guard_stage

# Verifica entorno mínimo (solo AWS_PROFILE obligatorio)
_guard_env:
	@if [ -z "$(AWS_PROFILE)" ]; then \
	  echo "❌ AWS_PROFILE no está seteado. Define AWS_PROFILE en tu entorno o en .env"; \
	  exit 1; \
	fi

# Verifica que STAGE esté seteado
_guard_stage:
	@if [ -z "$(STAGE)" ]; then \
	  echo "❌ STAGE no está seteado. Uso: make <comando> STAGE=<local|saturnino|dev|testing|production>"; \
	  exit 1; \
	fi

# Guard para deploy/remove/unlock/refresh: valida STAGE + matching branch/stage
_guard_deploy: _guard_env _guard_stage
	@case "$(BRANCH_NAME)" in \
	  local)     [ "$(STAGE)" = "local" ] || { echo "En rama 'local' usa STAGE=local"; exit 1; } ;; \
	  saturnino) [ "$(STAGE)" = "saturnino" ] || { echo "En rama 'saturnino' usa STAGE=saturnino"; exit 1; } ;; \
	  dev)       [ "$(STAGE)" = "dev" ] || { echo "En rama 'dev' usa STAGE=dev"; exit 1; } ;; \
	  test)      [ "$(STAGE)" = "testing" ] || { echo "En rama 'test' usa STAGE=testing"; exit 1; } ;; \
	  main)      [ "$(STAGE)" = "production" ] || { echo "En rama 'main' usa STAGE=production"; exit 1; } ;; \
	  *)         echo "Rama '$(BRANCH_NAME)' no tiene stage asignado. Usa una de: local, saturnino, dev, test, main"; exit 1 ;; \
	esac

# ---------- Chequeos ----------
doctor: _guard_env
	@command -v node >/dev/null 2>&1 || { echo "❌ Node.js no encontrado en PATH"; exit 1; }
	@command -v npx  >/dev/null 2>&1 || { echo "❌ npx no encontrado en PATH"; exit 1; }
	@command -v git  >/dev/null 2>&1 || { echo "❌ git no encontrado en PATH"; exit 1; }
	@echo "✅ Entorno OK. AWS_PROFILE=$(AWS_PROFILE)"

# ---------- Desarrollo (cualquier rama, STAGE obligatorio) ----------
sst-dev: _guard_env _guard_stage
	@$(AWS_ARGS) $(SST) dev --stage $(STAGE)

# ---------- Deploy / Remove / Unlock / Refresh (con matching branch/stage) ----------
sst-deploy: _guard_deploy _guard_stage
	@$(AWS_ARGS) $(SST) deploy --stage $(STAGE)

sst-remove: _guard_deploy _guard_stage
	@$(AWS_ARGS) $(SST) remove --stage $(STAGE)

sst-unlock: _guard_deploy _guard_stage
	@$(AWS_ARGS) $(SST) unlock --stage $(STAGE)

sst-refresh: _guard_deploy _guard_stage
	@$(AWS_ARGS) $(SST) refresh --stage $(STAGE)

sst-repair: _guard_env _guard_stage
	@$(AWS_ARGS) $(SST) state repair --stage $(STAGE)
